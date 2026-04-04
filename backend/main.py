from __future__ import annotations

import csv
import io
import math
import re
import zipfile
from dataclasses import dataclass, asdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from openpyxl import load_workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from unidecode import unidecode


# =========================
# Config ARVOX por defecto
# =========================
BASE_DIR = Path(__file__).resolve().parent
ASSETS_DIR = BASE_DIR / "assets"

LOGO_CANDIDATES = [
    ASSETS_DIR / "arvox_logo.png",
    ASSETS_DIR / "arvox_logo.jpg",
    ASSETS_DIR / "arvox_logo.jpeg",
]

DEFAULT_ACCENT = "#8B2E00"
DEFAULT_EXCHANGE_RATE = 490.0
DEFAULT_SINPE = "8415-2881"
DEFAULT_FOOTER_NAME = "Arián Alfaro"


app = FastAPI(title="ARVOX Facturas API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


HEADER_ALIASES = {
    "customername": {"nombre", "cliente", "customer", "customername"},
    "miamicode": {"mia", "miami", "miacode", "miamicode"},
    "trackingnumber": {"guia", "guía", "tracking", "trackingnumber", "numero de guia", "numero guia"},
    "description": {
        "descripcion",
        "descripción",
        "producto",
        "productos",
        "item",
        "descripcion del producto",
        "product",
    },
    "status": {"estatus", "estado", "status"},
    "weightkg": {"peso kg", "peso", "pesokg", "kg"},
    "weightlb": {"peso libras", "peso lb", "peso libras.", "pesolb", "libras", "lb"},
    "priceperlb": {"precio por lb", "tarifa", "priceperlb", "precio lb", "tarifa lb", "precio"},
    "rowtotal": {"total", "monto", "rowtotal"},
}


# =========================
# Models
# =========================
@dataclass
class ParsedRow:
    row_number: int
    customer_name: str
    original_customer_name: str
    miami_code: str
    tracking_number: str
    description: str
    status: str
    weight_kg: Optional[float]
    weight_lb: Optional[float]
    price_per_lb: Optional[float]
    row_total: Optional[float]


@dataclass
class InvalidRow:
    row_number: int
    reason: str
    raw: Dict[str, Any]


# =========================
# Helpers
# =========================
def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_key(value: str) -> str:
    text = unidecode(normalize_text(value).lower())
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def canonical_header(value: Any) -> Optional[str]:
    key = normalize_key(value)
    if not key:
        return None

    for canonical, aliases in HEADER_ALIASES.items():
        normalized_aliases = {normalize_key(alias) for alias in aliases}
        if key in normalized_aliases:
            return canonical

    if "peso" in key and ("libra" in key or key.endswith(" lb") or key == "lb"):
        return "weightlb"
    if "peso" in key and "kg" in key:
        return "weightkg"
    if "precio" in key and "lb" in key:
        return "priceperlb"

    return None


def parse_number(value: Any) -> Optional[float]:
    text = normalize_text(value)
    if not text:
        return None

    text = (
        text.replace("₡", "")
        .replace("$", "")
        .replace("USD", "")
        .replace("CRC", "")
        .replace("US$", "")
        .strip()
    )

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")

    try:
        return float(Decimal(text))
    except (InvalidOperation, ValueError):
        return None


def load_rows(file_bytes: bytes, filename: str) -> List[List[Any]]:
    lower = filename.lower()

    if lower.endswith(".csv"):
        decoded = file_bytes.decode("utf-8-sig", errors="replace")
        return [row for row in csv.reader(io.StringIO(decoded))]

    if lower.endswith(".xlsx") or lower.endswith(".xlsm"):
        workbook = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        worksheet = workbook.worksheets[0]
        return [list(row) for row in worksheet.iter_rows(values_only=True)]

    if lower.endswith(".xls"):
        raise HTTPException(
            status_code=400,
            detail="Los archivos .xls antiguos no están soportados. Convierte el archivo a .xlsx o .csv.",
        )

    raise HTTPException(status_code=400, detail="Solo se permiten archivos CSV, XLSX o XLSM.")


def row_to_normalized_text(row: List[Any]) -> str:
    return normalize_key(" ".join(normalize_text(cell) for cell in row if normalize_text(cell)))


def is_completely_blank(row_values: List[Any]) -> bool:
    return all(not normalize_text(v) for v in row_values)


def normalize_customer_name(name: str) -> str:
    return normalize_key(name)


def find_pending_section_start(rows: List[List[Any]]) -> int:
    for idx, row in enumerate(rows[:120]):
        text = row_to_normalized_text(row)
        if "pendientes" in text:
            return idx
    raise HTTPException(status_code=400, detail="No encontré una sección 'PENDIENTES' en el archivo.")


def detect_header_row_from_index(rows: List[List[Any]], start_idx: int) -> Tuple[int, Dict[int, str]]:
    best_idx = -1
    best_map: Dict[int, str] = {}
    best_score = -1

    search_end = min(len(rows), start_idx + 20)

    for idx in range(start_idx, search_end):
        row = rows[idx]
        mapping: Dict[int, str] = {}
        score = 0

        for col_idx, value in enumerate(row):
            canonical = canonical_header(value)
            if canonical and canonical not in mapping.values():
                mapping[col_idx] = canonical
                score += 1

        has_customer = "customername" in mapping.values()
        has_tracking = "trackingnumber" in mapping.values()
        has_description = "description" in mapping.values()
        has_weight = "weightkg" in mapping.values() or "weightlb" in mapping.values()

        row_score = score
        if has_customer:
            row_score += 2
        if has_tracking:
            row_score += 2
        if has_description:
            row_score += 2
        if has_weight:
            row_score += 1

        if row_score > best_score and has_customer and has_tracking:
            best_idx = idx
            best_map = mapping
            best_score = row_score

    if best_idx == -1:
        raise HTTPException(
            status_code=400,
            detail="No pude detectar la fila de encabezados dentro de la sección PENDIENTES.",
        )

    return best_idx, best_map


def should_stop_section(normalized_full_row_text: str) -> bool:
    if not normalized_full_row_text:
        return False

    stop_keywords = [
        "factura",
        "facturas",
        "facturado",
        "facturados",
        "entregados",
        "entregado",
    ]

    if any(keyword in normalized_full_row_text for keyword in stop_keywords):
        return True

    if "pendientes" in normalized_full_row_text:
        return True

    return False


def build_rows(raw_rows: List[List[Any]]) -> Tuple[List[ParsedRow], List[InvalidRow]]:
    pending_start_idx = find_pending_section_start(raw_rows)
    header_idx, header_map = detect_header_row_from_index(raw_rows, pending_start_idx)

    parsed_rows: List[ParsedRow] = []
    invalid_rows: List[InvalidRow] = []

    blank_streak = 0

    for i in range(header_idx + 1, len(raw_rows)):
        row = raw_rows[i]
        normalized_full_row_text = row_to_normalized_text(row)

        if is_completely_blank(row):
            blank_streak += 1
            if blank_streak >= 5:
                break
            continue
        else:
            blank_streak = 0

        if should_stop_section(normalized_full_row_text):
            break

        extracted: Dict[str, Any] = {field: "" for field in HEADER_ALIASES.keys()}
        extracted.update({"weightkg": None, "weightlb": None, "priceperlb": None, "rowtotal": None})

        for col_idx, canonical in header_map.items():
            value = row[col_idx] if col_idx < len(row) else None
            if canonical in {"weightkg", "weightlb", "priceperlb", "rowtotal"}:
                extracted[canonical] = parse_number(value)
            else:
                extracted[canonical] = normalize_text(value)

        row_number = i + 1
        customer_name = extracted.get("customername", "")
        tracking_number = extracted.get("trackingnumber", "")
        description = extracted.get("description", "")

        raw_payload = {
            "row_number": row_number,
            "customer_name": customer_name,
            "tracking_number": tracking_number,
            "description": description,
        }

        if not customer_name and not tracking_number and not description:
            continue

        if not customer_name:
            invalid_rows.append(
                InvalidRow(
                    row_number=row_number,
                    reason="Falta NOMBRE",
                    raw=raw_payload,
                )
            )
            continue

        if not tracking_number:
            invalid_rows.append(
                InvalidRow(
                    row_number=row_number,
                    reason="Falta GUIA",
                    raw=raw_payload,
                )
            )
            continue

        parsed_rows.append(
            ParsedRow(
                row_number=row_number,
                customer_name=normalize_customer_name(customer_name),
                original_customer_name=customer_name,
                miami_code=extracted.get("miamicode", ""),
                tracking_number=tracking_number,
                description=description or "Sin descripción",
                status=extracted.get("status", ""),
                weight_kg=extracted.get("weightkg"),
                weight_lb=extracted.get("weightlb"),
                price_per_lb=extracted.get("priceperlb"),
                row_total=extracted.get("rowtotal"),
            )
        )

    return parsed_rows, invalid_rows


def calculate_row_total(row: ParsedRow, default_unit_price: float, default_price_per_lb: float) -> float:
    if row.row_total is not None:
        return round(float(row.row_total), 2)

    if row.weight_lb is not None and row.price_per_lb is not None:
        return round(float(row.weight_lb) * float(row.price_per_lb), 2)

    if row.weight_lb is not None and row.price_per_lb is None and default_price_per_lb > 0:
        return round(float(row.weight_lb) * float(default_price_per_lb), 2)

    if row.weight_kg is not None and default_price_per_lb > 0:
        weight_lb = float(row.weight_kg) * 2.20462
        return round(weight_lb * default_price_per_lb, 2)

    return round(float(default_unit_price), 2)


def choose_best_customer_name(rows: List[ParsedRow]) -> str:
    return max(
        (r.original_customer_name.strip() for r in rows if r.original_customer_name.strip()),
        key=len,
        default="Cliente",
    )


def get_logo_path() -> Optional[Path]:
    for path in LOGO_CANDIDATES:
        if path.exists():
            return path
    return None


def build_customer_invoices(
    rows: List[ParsedRow],
    default_unit_price: float,
    default_price_per_lb: float,
) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[ParsedRow]] = {}

    for row in rows:
        grouped.setdefault(row.customer_name, []).append(row)

    invoices: List[Dict[str, Any]] = []

    for customer_key, customer_rows in grouped.items():
        display_name = choose_best_customer_name(customer_rows)
        miami_codes = sorted({r.miami_code for r in customer_rows if r.miami_code})

        items: List[Dict[str, Any]] = []
        all_guides: List[str] = []

        for row in customer_rows:
            effective_weight_lb = row.weight_lb
            if effective_weight_lb is None and row.weight_kg is not None:
                effective_weight_lb = round(float(row.weight_kg) * 2.20462, 3)

            effective_price_per_lb = (
                row.price_per_lb if row.price_per_lb is not None
                else (default_price_per_lb if default_price_per_lb > 0 else None)
            )

            # Si el Excel trae TOTAL, lo respetamos como total final en CRC
            if row.row_total is not None and row.row_total > 0:
                item_total_crc = round(float(row.row_total), 2)
                item_total_usd = None
            else:
                calculated_usd = calculate_row_total(row, default_unit_price, default_price_per_lb)

                if calculated_usd is None or calculated_usd <= 0:
                    continue

                item_total_usd = round(float(calculated_usd), 2)
                item_total_crc = None

            item_guides = [row.tracking_number] if row.tracking_number else []
            all_guides.extend(item_guides)

            items.append(
                {
                    "description": row.description,
                    "quantity": 1,
                    "weight_lb": effective_weight_lb,
                    "price_per_lb": effective_price_per_lb,
                    "total_usd": item_total_usd,
                    "total_crc": item_total_crc,
                    "guides": item_guides,
                }
            )

        if not items:
            continue

        unique_guides = sorted(set(all_guides))

        subtotal_crc = 0.0
        subtotal_usd = 0.0

        for item in items:
            subtotal_crc += float(item["total_crc"] or 0)
            subtotal_usd += float(item["total_usd"] or 0)

        invoices.append(
            {
                "customerKey": customer_key,
                "customerName": display_name,
                "guides": unique_guides,
                "miamiCodes": miami_codes,
                "items": items,
                "subtotal_crc": round(subtotal_crc, 2),
                "subtotal_usd": round(subtotal_usd, 2),
                "total_crc": round(subtotal_crc, 2),
                "total_usd": round(subtotal_usd, 2),
                "itemCount": len(items),
            }
        )

    invoices.sort(key=lambda x: x["customerName"].lower())
    return invoices

def money_usd(value: float) -> str:
    return f"${value:,.2f}"


def money_crc_text(value: float) -> str:
    return f"CRC {value:,.0f}"


def create_invoice_pdf(invoice: Dict[str, Any], settings: Dict[str, Any]) -> bytes:
    buffer = io.BytesIO()
    page_width, page_height = A4
    c = canvas.Canvas(buffer, pagesize=A4)

    accent = colors.HexColor(settings.get("accentColor") or DEFAULT_ACCENT)
    exchange_rate = float(settings.get("exchangeRate") or DEFAULT_EXCHANGE_RATE)
    sinpe_number = settings.get("sinpeNumber") or DEFAULT_SINPE
    footer_name = settings.get("footerText") or DEFAULT_FOOTER_NAME

    customer_name = invoice.get("customerName", "Cliente")

    now = datetime.now()
    invoice_date = f"{now.day}/{now.month}/{now.year}"

    items = invoice.get("items", [])
    if not items:
        items = [{
            "description": "Sin descripción",
            "weight_lb": None,
            "price_per_lb": None,
            "total_usd": None,
            "total_crc": 0.0,
            "guides": [],
        }]

    # Si ya viene total_crc desde el Excel, usamos ese
    invoice_total_crc = float(invoice.get("total_crc") or 0)

    # Si no viene total_crc, calculamos desde total_usd
    if invoice_total_crc <= 0:
        total_usd = float(invoice.get("total_usd") or 0)
        invoice_total_crc = round(total_usd * exchange_rate, 2)

    def centered(text: str, x: float, y: float, size=10, font="Helvetica", color=colors.black):
        c.setFont(font, size)
        c.setFillColor(color)
        c.drawCentredString(x, y, str(text))

    def left(text: str, x: float, y: float, size=10, font="Helvetica", color=colors.black):
        c.setFont(font, size)
        c.setFillColor(color)
        c.drawString(x, y, str(text))

    def right(text: str, x: float, y: float, size=10, font="Helvetica", color=colors.black):
        c.setFont(font, size)
        c.setFillColor(color)
        c.drawRightString(x, y, str(text))

    def money_usd(value: float) -> str:
        return f"${value:,.2f}"

    def money_crc_text(value: float) -> str:
        return f"CRC {value:,.2f}"

    c.setFillColor(colors.HexColor("#f3f3f3"))
    c.rect(0, 0, page_width, page_height, fill=1, stroke=0)

    margin = 26
    c.setStrokeColor(accent)
    c.setLineWidth(10)
    c.rect(margin, margin, page_width - margin * 2, page_height - margin * 2, stroke=1, fill=0)

    logo_w = 135
    logo_h = 54
    logo_x = (page_width - logo_w) / 2
    logo_y = page_height - 120

    c.setFillColor(accent)
    c.roundRect(logo_x, logo_y, logo_w, logo_h, 10, stroke=0, fill=1)

    centered("ARVOX", page_width / 2, logo_y + 28, size=24, font="Helvetica-Bold", color=colors.white)
    centered("COURIER", page_width / 2, logo_y + 10, size=9, font="Helvetica", color=colors.white)

    header_y = logo_y - 42
    left("CLIENTE", 60, header_y, size=8, font="Helvetica-Bold")
    #left("NÚMERO DE PAQUETE", 205, header_y, size=8, font="Helvetica-Bold")
    left("FECHA", 400, header_y, size=8, font="Helvetica-Bold")

    left(customer_name[:28], 60, header_y - 28, size=10, font="Helvetica")
    left(invoice_date, 400, header_y - 28, size=10, font="Helvetica")

    table_x = 48
    table_y = header_y - 78
    table_w = page_width - 96
    table_h = 26

    guide_w = 120
    desc_w = 135
    weight_w = 58
    price_w = 58
    total_w = table_w - guide_w - desc_w - weight_w - price_w

    c.setFillColor(accent)
    c.roundRect(table_x, table_y, table_w, table_h, 6, stroke=0, fill=1)

    centered("PAQUETE", table_x + guide_w / 2, table_y + 9, size=8, font="Helvetica-Bold", color=colors.white)
    centered("DESCRIPCIÓN", table_x + guide_w + desc_w / 2, table_y + 9, size=8, font="Helvetica-Bold", color=colors.white)
    centered("PESO LB", table_x + guide_w + desc_w + weight_w / 2, table_y + 9, size=8, font="Helvetica-Bold", color=colors.white)
    centered("PRECIO\LB", table_x + guide_w + desc_w + weight_w + price_w / 2, table_y + 7, size=7, font="Helvetica-Bold", color=colors.white)
    centered("TOTAL", table_x + guide_w + desc_w + weight_w + price_w + total_w / 2, table_y + 9, size=8, font="Helvetica-Bold", color=colors.white)

    row_y = table_y - 18
    row_gap = 16
    max_rows_visible = 9

    visible_items = items[:max_rows_visible]

    for item in visible_items:
        guide_text = ", ".join(item.get("guides", [])) if item.get("guides") else "N/A"
        if len(guide_text) > 20:
            guide_text = guide_text[:17] + "..."

        description = (item.get("description") or "Sin descripción").upper()
        if len(description) > 22:
            description = description[:19] + "..."

        weight_lb = item.get("weight_lb")
        price_per_lb = item.get("price_per_lb")

        if item.get("total_crc") is not None:
            item_total_crc = float(item["total_crc"])
        else:
            item_total_usd = float(item.get("total_usd") or 0)
            item_total_crc = round(item_total_usd * exchange_rate, 2)

        centered(guide_text, table_x + guide_w / 2, row_y, size=8, font="Helvetica")
        centered(description, table_x + guide_w + desc_w / 2, row_y, size=8, font="Helvetica")
        centered(
            "" if weight_lb is None else f"{float(weight_lb):.3f}".rstrip("0").rstrip("."),
            table_x + guide_w + desc_w + weight_w / 2,
            row_y,
            size=8,
            font="Helvetica",
        )
        centered(
            "" if price_per_lb is None else money_usd(float(price_per_lb)),
            table_x + guide_w + desc_w + weight_w + price_w / 2,
            row_y,
            size=8,
            font="Helvetica",
        )
        centered(
            money_crc_text(item_total_crc),
            table_x + guide_w + desc_w + weight_w + price_w + total_w / 2,
            row_y,
            size=8,
            font="Helvetica",
        )

        row_y -= row_gap

    c.setStrokeColor(colors.black)
    c.setLineWidth(1)
    c.line(table_x + 100, row_y + 6, table_x + table_w - 100, row_y + 6)

    monto_y = row_y - 58
    centered("MONTO POR PESO", page_width / 2 - 18, monto_y, size=16, font="Helvetica", color=colors.HexColor("#5a5a5a"))
    right(money_crc_text(invoice_total_crc), page_width - 108, monto_y, size=12, font="Helvetica")

    pagar_y = monto_y - 50
    left("CANTIDAD A PAGAR", 110, pagar_y, size=16, font="Helvetica-Bold", color=colors.HexColor("#444444"))

    total_box_w = 112
    total_box_h = 28
    total_box_x = page_width - 155
    total_box_y = pagar_y - 10

    c.setFillColor(accent)
    c.roundRect(total_box_x, total_box_y, total_box_w, total_box_h, 7, stroke=0, fill=1)
    centered(money_crc_text(invoice_total_crc), total_box_x + total_box_w / 2, total_box_y + 9, size=14, font="Helvetica-Bold", color=colors.white)

    logo_path = get_logo_path()
    if logo_path:
        try:
            logo_reader = ImageReader(str(logo_path))
            c.drawImage(logo_reader, 170, 70, width=95, height=95, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass

    sinpe_x = page_width / 2 + 34
    sinpe_y = 118

    left("SINPE", sinpe_x, sinpe_y + 6, size=12, font="Helvetica-Bold")
    left(sinpe_number, sinpe_x, sinpe_y - 18, size=12, font="Helvetica")
    left(footer_name, sinpe_x, sinpe_y - 42, size=11, font="Helvetica")

    c.showPage()
    c.save()

    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes

# =========================
# API
# =========================
@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/process")
async def process_file(
    file: UploadFile = File(...),
    default_unit_price: float = Form(0.0),
    default_price_per_lb: float = Form(0.0),
):
    content = await file.read()
    raw_rows = load_rows(content, file.filename)
    rows, invalid_rows = build_rows(raw_rows)
    invoices = build_customer_invoices(rows, default_unit_price, default_price_per_lb)

    summary = {
        "totalRows": len(rows) + len(invalid_rows),
        "validRows": len(rows),
        "invalidRows": len(invalid_rows),
        "uniqueCustomers": len({r.customer_name for r in rows}),
        "invoicesToGenerate": len(invoices),
    }

    return {
        "summary": summary,
        "invoices": invoices,
        "invalidRows": [asdict(row) for row in invalid_rows],
    }


@app.post("/api/generate-pdf")
async def generate_pdf(payload: Dict[str, Any]):
    invoice = payload.get("invoice")
    settings = payload.get("settings", {})

    if not invoice:
        raise HTTPException(status_code=400, detail="Falta invoice en el payload.")

    pdf_bytes = create_invoice_pdf(invoice, settings)
    filename = normalize_key(invoice.get("customerName", "cliente")).replace(" ", "_") or "factura"
    headers = {"Content-Disposition": f'attachment; filename="factura_{filename}.pdf"'}

    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@app.post("/api/generate-zip")
async def generate_zip(payload: Dict[str, Any]):
    invoices = payload.get("invoices", [])
    settings = payload.get("settings", {})

    if not invoices:
        raise HTTPException(status_code=400, detail="No hay facturas para exportar.")

    memory = io.BytesIO()

    with zipfile.ZipFile(memory, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for invoice in invoices:
            pdf_bytes = create_invoice_pdf(invoice, settings)
            name = normalize_key(invoice.get("customerName", "cliente")).replace(" ", "_") or "factura"
            zf.writestr(f"factura_{name}.pdf", pdf_bytes)

    memory.seek(0)
    headers = {"Content-Disposition": 'attachment; filename="facturas.zip"'}

    return StreamingResponse(memory, media_type="application/zip", headers=headers)