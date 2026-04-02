# Creador de Facturas

Stack:
- Backend: FastAPI + pandas + reportlab
- Frontend: HTML/CSS/JS

## 1) Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend disponible en:
- http://127.0.0.1:8000
- Swagger: http://127.0.0.1:8000/docs

## 2) Frontend

Abre otra terminal:

```bash
cd frontend
python -m http.server 5500
```

Abre en el navegador:
- http://127.0.0.1:5500

## Funcionalidad

- Lee CSV/XLSX
- Detecta encabezados aunque no estén en la primera fila
- Genera 1 factura por cliente
- Suma automáticamente el total de la factura
- Descarga PDF individual
- Descarga ZIP con todas las facturas

## Notas

- Si una fila trae TOTAL, usa ese valor
- Si no trae TOTAL pero sí PESO LB y PRECIO POR LB, calcula total = peso * tarifa
- Si no existe ninguna de las dos, usa el precio por defecto configurado
