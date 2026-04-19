const API_BASE = 'https://facturas-app-1.onrender.com';

const ARVOX_DEFAULTS = {
  companyName: 'ARVOX COURIER',
  accentColor: '#8B2E00',
  sinpeNumber: '8415-2881',
  footerText: 'Arián Alfaro',
  exchangeRate: 490,
  currency: 'USD',
  defaultUnitPrice: 0,
  defaultPricePerLb: 6,
  includeMiamiCode: false,
};

const state = {
  invoices: [],
  invalidRows: [],
  summary: null,
  currentFile: null,
};

const PAGE_SIZE = 25;
const pages = { preview: 1, invalid: 1, history: 1, cobrados: 1 };

function setBadge(key, count) {
  const el = document.getElementById(`badge-${key}`);
  if (el) el.textContent = count;
}

function paginationHtml(key, total) {
  if (total <= PAGE_SIZE) return '';
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const cur = pages[key];
  let btns = '';
  for (let i = 1; i <= totalPages; i++) {
    btns += `<button class="page-btn${i === cur ? ' page-active' : ''}" data-pkey="${key}" data-pnum="${i}">${i}</button>`;
  }
  return `<div class="pagination">${btns}</div>`;
}

document.addEventListener('click', event => {
  const pkey = event.target.getAttribute('data-pkey');
  const pnum = event.target.getAttribute('data-pnum');
  if (pkey && pnum) {
    pages[pkey] = parseInt(pnum, 10);
    if (pkey === 'preview')  renderPreviewTable();
    if (pkey === 'invalid')  renderInvalidRows();
    if (pkey === 'history')  renderDownloadedInvoices();
    if (pkey === 'cobrados') renderCobrados();
  }
});

document.addEventListener('click', event => {
  const header = event.target.closest('[data-toggle]');
  if (!header) return;
  // Don't toggle when clicking inside inputs or buttons other than the toggle-btn
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
  if (event.target.tagName === 'BUTTON' && !event.target.classList.contains('toggle-btn')) return;
  const key = header.getAttribute('data-toggle');
  const section = document.querySelector(`[data-section="${key}"]`);
  if (section) section.classList.toggle('collapsed');
});

const els = {
  fileInput: document.getElementById('fileInput'),
  fileLabel: document.getElementById('fileLabel'),
  processBtn: document.getElementById('processBtn'),
  statusText: document.getElementById('statusText'),
  summaryGrid: document.getElementById('summaryGrid'),
  invoiceList: document.getElementById('invoiceList'),
  invalidRows: document.getElementById('invalidRows'),
  previewTable: document.getElementById('previewTable'),
  searchInput: document.getElementById('searchInput'),
  downloadZipBtn: document.getElementById('downloadZipBtn'),
  invoiceDialog: document.getElementById('invoiceDialog'),
  invoicePreview: document.getElementById('invoicePreview'),
  closeDialogBtn: document.getElementById('closeDialogBtn'),
  historyList: document.getElementById('historyList'),
  historySearchInput: document.getElementById('historySearchInput'),
  refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),

  companyName: document.getElementById('companyName'),
  sinpeNumber: document.getElementById('sinpeNumber'),
  currency: document.getElementById('currency'),
  defaultUnitPrice: document.getElementById('defaultUnitPrice'),
  accentColor: document.getElementById('accentColor'),
  footerText: document.getElementById('footerText'),
  includeMiamiCode: document.getElementById('includeMiamiCode'),
  exchangeRate: document.getElementById('exchangeRate'),
  defaultPricePerLb: document.getElementById('defaultPricePerLb'),
};

function hydrateDefaultInputs() {
  if (els.companyName && !els.companyName.value) els.companyName.value = ARVOX_DEFAULTS.companyName;
  if (els.sinpeNumber && !els.sinpeNumber.value) els.sinpeNumber.value = ARVOX_DEFAULTS.sinpeNumber;
  if (els.currency && !els.currency.value) els.currency.value = ARVOX_DEFAULTS.currency;
  if (els.defaultUnitPrice && !els.defaultUnitPrice.value) els.defaultUnitPrice.value = String(ARVOX_DEFAULTS.defaultUnitPrice);
  if (els.accentColor && !els.accentColor.value) els.accentColor.value = ARVOX_DEFAULTS.accentColor;
  if (els.footerText && !els.footerText.value) els.footerText.value = ARVOX_DEFAULTS.footerText;
  if (els.exchangeRate && !els.exchangeRate.value) els.exchangeRate.value = String(ARVOX_DEFAULTS.exchangeRate);
  if (els.defaultPricePerLb && !els.defaultPricePerLb.value) els.defaultPricePerLb.value = String(ARVOX_DEFAULTS.defaultPricePerLb);
  if (els.includeMiamiCode) els.includeMiamiCode.checked = ARVOX_DEFAULTS.includeMiamiCode;
}

function getSettings() {
  return {
    companyName: els.companyName?.value?.trim() || ARVOX_DEFAULTS.companyName,
    sinpeNumber: els.sinpeNumber?.value?.trim() || ARVOX_DEFAULTS.sinpeNumber,
    currency: els.currency?.value || ARVOX_DEFAULTS.currency,
    defaultUnitPrice: parseFloat(els.defaultUnitPrice?.value || String(ARVOX_DEFAULTS.defaultUnitPrice)),
    defaultPricePerLb: parseFloat(els.defaultPricePerLb?.value || String(ARVOX_DEFAULTS.defaultPricePerLb)),
    accentColor: els.accentColor?.value || ARVOX_DEFAULTS.accentColor,
    footerText: els.footerText?.value?.trim() || ARVOX_DEFAULTS.footerText,
    includeMiamiCode: !!els.includeMiamiCode?.checked,
    exchangeRate: parseFloat(els.exchangeRate?.value || String(ARVOX_DEFAULTS.exchangeRate)),
  };
}

function moneyUSD(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function moneyCRC(value) {
  return `CRC ${Number(value || 0).toLocaleString('es-CR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function trackingLast6(tracking) {
  const digits = String(tracking || '').replace(/\D/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  const t = String(tracking || '');
  if (t.length >= 6) return t.slice(-6);
  return t || 'N/A';
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function renderSummary() {
  if (!state.summary) {
    els.summaryGrid.innerHTML = '';
    return;
  }

  const cards = [
    ['Filas totales', state.summary.totalRows],
    ['Filas válidas', state.summary.validRows],
    ['Filas inválidas', state.summary.invalidRows],
    ['Clientes únicos', state.summary.uniqueCustomers],
    ['Facturas', state.summary.invoicesToGenerate],
  ];

  els.summaryGrid.innerHTML = cards.map(([label, value]) => `
    <div class="summary-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
    </div>
  `).join('');
}

function renderInvalidRows() {
  setBadge('invalid', state.invalidRows.length);
  if (!state.invalidRows.length) {
    els.invalidRows.innerHTML = '<div class="empty">Sin filas inválidas.</div>';
    return;
  }
  const total = state.invalidRows.length;
  const start = (pages.invalid - 1) * PAGE_SIZE;
  const slice = state.invalidRows.slice(start, start + PAGE_SIZE);

  els.invalidRows.innerHTML = `
    <table>
      <thead><tr><th>Fila</th><th>Razón</th><th>Datos</th></tr></thead>
      <tbody>
        ${slice.map(row => `
          <tr>
            <td>${row.row_number}</td>
            <td>${row.reason}</td>
            <td>${Object.values(row.raw).filter(Boolean).join(' | ')}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${paginationHtml('invalid', total)}`;
}

function renderPreviewTable() {
  if (!state.invoices.length) {
    els.previewTable.innerHTML = '<div class="empty">No hay datos procesados.</div>';
    return;
  }

  const settings = getSettings();

  const rows = state.invoices.flatMap(invoice =>
    invoice.items.map(item => {
      const totalCrc = item.total_crc > 0
        ? Number(item.total_crc)
        : Math.round(Number(item.total_usd || 0) * settings.exchangeRate);

      return {
        customerName: invoice.customerName,
        guide: (item.guides || []).join(', ') || 'N/A',
        description: item.description,
        weightLb: item.weight_lb ?? '',
        pricePerLb: item.price_per_lb,
        totalCrc,
      };
    })
  );

  setBadge('preview', rows.length);
  const total = rows.length;
  const start = (pages.preview - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  els.previewTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Cliente</th><th>Paquete</th><th>Descripción</th>
          <th>Peso lb</th><th>Precio/lb</th><th>Total CRC</th>
        </tr>
      </thead>
      <tbody>
        ${slice.map(row => `
          <tr>
            <td>${row.customerName}</td>
            <td>${row.guide}</td>
            <td>${row.description}</td>
            <td>${row.weightLb}</td>
            <td>${row.pricePerLb != null ? moneyUSD(row.pricePerLb) : ''}</td>
            <td>${moneyCRC(row.totalCrc)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${paginationHtml('preview', total)}`;
}

function renderInvoiceList() {
  const settings = getSettings();
  const query = (els.searchInput.value || '').trim().toLowerCase();

  const filtered = state.invoices.filter(invoice => {
    if (!query) return true;
    const guides = (invoice.guides || []).join(' ').toLowerCase();
    return invoice.customerName.toLowerCase().includes(query) || guides.includes(query);
  });

  if (!filtered.length) {
    els.invoiceList.innerHTML = '<div class="empty">No hay facturas para mostrar.</div>';
    return;
  }

  els.invoiceList.innerHTML = filtered.map(invoice => {
    const totalCrc = invoice.total_crc > 0
      ? Number(invoice.total_crc)
      : Math.round(Number(invoice.total_usd || 0) * settings.exchangeRate);

    const itemsHtml = invoice.items.map((item, idx) => {
      const itemCrc = item.total_crc > 0
        ? Number(item.total_crc)
        : Math.round(Number(item.total_usd || 0) * settings.exchangeRate);
      const guideRaw = (item.guides || [])[0] || '';
      const guideDisplay = trackingLast6(guideRaw) || guideRaw || 'N/A';
      const desc = (item.description || 'Sin descripción').replace(/'/g, '&#39;');
      return `
        <label class="item-check-row${idx % 2 === 0 ? ' item-row-even' : ''}">
          <input type="checkbox" class="item-cobrado-check"
            data-guide="${guideRaw}"
            data-customer="${invoice.customerName.replace(/"/g, '&quot;')}"
            data-desc="${desc}"
            data-usd="${item.total_usd || 0}"
            data-crc="${itemCrc}" />
          <span class="item-guide-cell">${guideDisplay}</span>
          <span class="item-desc-cell">${item.description || 'Sin descripción'}</span>
          <span class="item-total-cell">${moneyCRC(itemCrc)}</span>
        </label>`;
    }).join('');

    return `
      <article class="invoice-card">
        <div class="invoice-card-top">
          <div>
            <h3>${invoice.customerName}</h3>
            <p class="muted">${invoice.itemCount} producto(s) · ${moneyCRC(totalCrc)}</p>
          </div>
          <div class="tags">
            ${(invoice.guides || []).map(g => `<span class="tag">${g}</span>`).join('') || '<span class="tag">Sin guía</span>'}
          </div>
        </div>

        <div class="invoice-items-panel" id="panel-${invoice.customerKey}">
          <div class="items-panel-header">
            <span class="muted" style="font-size:13px">Selecciona los productos cobrados:</span>
            <button class="btn-cobrar ghost small" data-cobrar-key="${invoice.customerKey}">Cobrar seleccionados</button>
          </div>
          <div class="items-list">${itemsHtml}</div>
        </div>

        <div class="invoice-actions">
          <button class="ghost" data-preview="${invoice.customerKey}">Vista previa</button>
          <button class="ghost" data-toggle-items="${invoice.customerKey}">▼ Productos</button>
          <button class="secondary" data-sent="${invoice.customerKey}">Marcar enviado</button>
          <button class="primary" data-pdf="${invoice.customerKey}">Descargar PDF</button>
        </div>
      </article>`;
  }).join('');
}

function renderInvoicePreview(invoice) {
  const settings = getSettings();
  const totalCrc = invoice.total_crc > 0
    ? Number(invoice.total_crc)
    : Math.round(Number(invoice.total_usd || 0) * settings.exchangeRate);
  const totalUsd = Number(invoice.total_usd || 0);
  const today = new Date().toLocaleDateString('es-CR');

  els.invoicePreview.innerHTML = `
    <div class="arvox-preview" style="--accent:${settings.accentColor}">
      <div class="arvox-sheet">
        <div class="arvox-border">

          <div class="arvox-logo-top">
            <div class="arvox-logo-box">
              <div class="arvox-logo-main">ARVOX</div>
              <div class="arvox-logo-sub">COURIER</div>
            </div>
          </div>

          <div class="arvox-header-row">
            <div>
              <div class="arvox-label">CLIENTE</div>
              <div class="arvox-value">${invoice.customerName.toUpperCase()}</div>
            </div>
            <div class="arvox-header-right">
              <div class="arvox-label">FECHA</div>
              <div class="arvox-value">${today}</div>
            </div>
          </div>

          <div class="arvox-divider"></div>

          <div class="arvox-table">
            <div class="arvox-table-head arvox-row">
              <div>PAQUETE</div>
              <div>DESCRIPCIÓN</div>
              <div>PESO LB</div>
              <div>PRECIO / LB</div>
              <div>TOTAL</div>
            </div>

            <div class="arvox-table-body">
              ${invoice.items.map((item, idx) => {
                const itemTotalCrc = item.total_crc > 0
                  ? Number(item.total_crc)
                  : Math.round(Number(item.total_usd || 0) * settings.exchangeRate);
                const guides = (item.guides || []).map(g => trackingLast6(g)).join(', ') || 'N/A';
                const weightText = item.weight_lb != null
                  ? Number(item.weight_lb).toFixed(3).replace(/\.?0+$/, '')
                  : '';
                return `
                  <div class="arvox-row${idx % 2 === 0 ? ' arvox-row-even' : ''}">
                    <div>${guides}</div>
                    <div>${(item.description || 'Sin descripción').toUpperCase()}</div>
                    <div>${weightText}</div>
                    <div>${item.price_per_lb != null ? moneyUSD(item.price_per_lb) : ''}</div>
                    <div><strong>${moneyCRC(itemTotalCrc)}</strong></div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <div class="arvox-divider arvox-divider-light"></div>

          <div class="arvox-summary">
            <div class="arvox-summary-line">
              <span>TOTAL EN DÓLARES</span>
              <strong>${moneyUSD(totalUsd)}</strong>
            </div>
            <div class="arvox-summary-line">
              <span>MONTO EN COLONES</span>
              <span>${moneyCRC(totalCrc)}</span>
            </div>
            <div class="arvox-pay-row">
              <span class="arvox-pay-label">CANTIDAD A PAGAR</span>
              <span class="arvox-pay-box">${moneyCRC(totalCrc)}</span>
            </div>
          </div>

          <div class="arvox-footer">
            <div class="arvox-sinpe">
              <div class="arvox-sinpe-title">SINPE MÓVIL</div>
              <div class="arvox-sinpe-number">${settings.sinpeNumber}</div>
              <div class="arvox-sinpe-name">${settings.footerText}</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
}

let allDownloadedInvoices = [];
let allCobrados = [];

async function markAsSent(customerKey) {
  const invoice = state.invoices.find(i => i.customerKey === customerKey);
  if (!invoice) return;

  const res = await fetch(`${API_BASE}/api/mark-as-sent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice }),
  });

  if (!res.ok) { alert('Error al marcar como enviado.'); return; }

  state.invoices = state.invoices.filter(i => i.customerKey !== customerKey);
  renderInvoiceList();
  loadDownloadedInvoices();
  setStatus('Factura marcada como enviada.');
}

async function markSelectedCobrado(customerKey) {
  const panel = document.getElementById(`panel-${customerKey}`);
  if (!panel) return;

  const checked = [...panel.querySelectorAll('.item-cobrado-check:checked')];
  if (!checked.length) { alert('Selecciona al menos un producto.'); return; }

  const items = checked.map(cb => ({
    guide: cb.dataset.guide,
    customerName: cb.dataset.customer,
    description: cb.dataset.desc,
    total_usd: parseFloat(cb.dataset.usd || 0),
    total_crc: parseFloat(cb.dataset.crc || 0),
  }));

  const res = await fetch(`${API_BASE}/api/mark-cobrado`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) { alert('Error al marcar como cobrado.'); return; }

  const markedGuides = new Set(items.map(i => i.guide));
  const invoice = state.invoices.find(i => i.customerKey === customerKey);
  if (invoice) {
    invoice.items = invoice.items.filter(item => !markedGuides.has((item.guides || [])[0] || ''));
    if (!invoice.items.length) {
      state.invoices = state.invoices.filter(i => i.customerKey !== customerKey);
    } else {
      invoice.itemCount = invoice.items.length;
    }
  }

  renderInvoiceList();
  loadCobrados();
  setStatus('Productos marcados como cobrados.');
}

async function loadCobrados() {
  try {
    const res = await fetch(`${API_BASE}/api/cobrados`);
    const data = await res.json();
    allCobrados = data.cobrados || [];
    renderCobrados();
  } catch {
    document.getElementById('cobradosList').innerHTML = '<p class="muted">No se pudo cargar.</p>';
  }
}

function renderCobrados() {
  const el = document.getElementById('cobradosList');
  const query = (document.getElementById('cobradosSearch')?.value || '').trim().toLowerCase();
  const settings = getSettings();

  const filtered = [...allCobrados].reverse().filter(c => {
    if (!query) return true;
    return (c.customerName || '').toLowerCase().includes(query)
        || (c.guide || '').toLowerCase().includes(query)
        || (c.description || '').toLowerCase().includes(query);
  });

  setBadge('cobrados', allCobrados.length);

  if (!filtered.length) {
    el.innerHTML = '<div class="empty">No hay productos cobrados registrados.</div>';
    return;
  }

  const total = filtered.length;
  const start = (pages.cobrados - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Guía</th><th>Cliente</th><th>Descripción</th>
          <th>Fecha</th><th>Total CRC</th><th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${slice.map(c => {
          const crc = c.total_crc > 0
            ? Number(c.total_crc)
            : Math.round(Number(c.total_usd || 0) * settings.exchangeRate);
          const gn = (c.guide_normalized || '').replace(/'/g, '&#39;');
          return `
            <tr id="cobrado-row-${gn}">
              <td>${c.guide}</td>
              <td class="cobrado-customer">${c.customerName}</td>
              <td class="cobrado-desc">${c.description}</td>
              <td>${c.date}</td>
              <td>${moneyCRC(crc)}</td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <button class="ghost small" data-edit-cobrado="${gn}">Editar</button>
                  <button class="danger small" data-unmark-cobrado="${gn}">Desmarcar</button>
                </div>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${paginationHtml('cobrados', total)}`;
}

async function loadDownloadedInvoices() {
  try {
    const res = await fetch(`${API_BASE}/api/downloaded-invoices`);
    const data = await res.json();
    allDownloadedInvoices = data.downloaded_invoices || [];
    renderDownloadedInvoices();
  } catch {
    els.historyList.innerHTML = '<p class="muted">No se pudo cargar el historial.</p>';
  }
}

function renderDownloadedInvoices() {
  const query = (els.historySearchInput?.value || '').trim().toLowerCase();
  const filtered = [...allDownloadedInvoices].reverse().filter(record => {
    if (!query) return true;
    const guides = (record.guides || []).join(' ').toLowerCase();
    return record.customerName.toLowerCase().includes(query) || guides.includes(query);
  });

  setBadge('history', allDownloadedInvoices.length);

  if (!filtered.length) {
    els.historyList.innerHTML = '<div class="empty">No hay facturas descargadas aún.</div>';
    return;
  }

  const total = filtered.length;
  const start = (pages.history - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  els.historyList.innerHTML = slice.map(record => {
    const totalCrc = record.total_crc > 0
      ? Number(record.total_crc)
      : Math.round(Number(record.total_usd || 0) * getSettings().exchangeRate);
    return `
      <article class="invoice-card">
        <div class="invoice-card-top">
          <div>
            <h3>${record.customerName}</h3>
            <p class="muted">${record.date} · ${moneyCRC(totalCrc)}</p>
          </div>
          <div class="tags">
            ${(record.guides || []).map(g => `<span class="tag">${g}</span>`).join('') || '<span class="tag">Sin guía</span>'}
          </div>
        </div>
        <div class="invoice-actions">
          <button class="ghost" data-hist-preview='${JSON.stringify(record.invoice)}'>Vista previa</button>
          <button class="primary" data-hist-pdf='${JSON.stringify(record.invoice)}'>Re-descargar PDF</button>
        </div>
      </article>`;
  }).join('') + paginationHtml('history', total);
}

async function redownloadPdf(invoice) {
  const res = await fetch(`${API_BASE}/api/redownload-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice, settings: getSettings() }),
  });

  if (!res.ok) {
    alert('No se pudo regenerar el PDF.');
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `factura_${(invoice.customerName || 'cliente').replace(/\s+/g, '_')}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function processFile() {
  if (!state.currentFile) {
    alert('Selecciona un archivo primero.');
    return;
  }

  const settings = getSettings();
  const formData = new FormData();
  formData.append('file', state.currentFile);
  formData.append('default_unit_price', String(settings.defaultUnitPrice));
  formData.append('default_price_per_lb', String(settings.defaultPricePerLb));

  setStatus('Procesando archivo…');
  els.processBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/process`, {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Error procesando archivo');
    }

    state.summary = data.summary;
    state.invoices = data.invoices;
    state.invalidRows = data.invalidRows;

    renderSummary();
    renderInvalidRows();
    renderPreviewTable();
    renderInvoiceList();
    els.downloadZipBtn.disabled = !state.invoices.length;

    setStatus(`Listo. ${data.summary.invoicesToGenerate} factura(s) generada(s).`);
    loadDownloadedInvoices();
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Ocurrió un error.');
    alert(error.message || 'Error');
  } finally {
    els.processBtn.disabled = false;
  }
}

async function downloadPdf(customerKey) {
  const invoice = state.invoices.find(i => i.customerKey === customerKey);
  if (!invoice) return;

  const res = await fetch(`${API_BASE}/api/generate-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoice,
      settings: getSettings(),
    }),
  });

  if (!res.ok) {
    alert('No se pudo generar el PDF.');
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `factura_${customerKey}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadZip() {
  if (!state.invoices.length) return;

  const res = await fetch(`${API_BASE}/api/generate-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoices: state.invoices,
      settings: getSettings(),
    }),
  });

  if (!res.ok) {
    alert('No se pudo generar el ZIP.');
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'facturas.zip';
  a.click();
  URL.revokeObjectURL(url);
  loadDownloadedInvoices();
}

els.fileInput.addEventListener('change', event => {
  const file = event.target.files?.[0];
  state.currentFile = file || null;
  els.fileLabel.textContent = file ? file.name : 'Arrastra o selecciona tu archivo XLSX/CSV';
  setStatus(file ? 'Archivo listo para procesar.' : 'Esperando archivo…');
});

els.processBtn.addEventListener('click', processFile);
els.searchInput.addEventListener('input', renderInvoiceList);
els.downloadZipBtn.addEventListener('click', downloadZip);
els.closeDialogBtn.addEventListener('click', () => els.invoiceDialog.close());
els.refreshHistoryBtn.addEventListener('click', loadDownloadedInvoices);
els.historySearchInput.addEventListener('input', renderDownloadedInvoices);
document.getElementById('cobradosSearch').addEventListener('input', renderCobrados);
document.getElementById('refreshCobradosBtn').addEventListener('click', loadCobrados);

els.invoiceList.addEventListener('click', event => {
  const btn = event.target;
  const previewKey  = btn.getAttribute('data-preview');
  const pdfKey      = btn.getAttribute('data-pdf');
  const sentKey     = btn.getAttribute('data-sent');
  const toggleKey   = btn.getAttribute('data-toggle-items');
  const cobrarKey   = btn.getAttribute('data-cobrar-key');

  if (previewKey) {
    const invoice = state.invoices.find(i => i.customerKey === previewKey);
    if (!invoice) return;
    renderInvoicePreview(invoice);
    els.invoiceDialog.showModal();
  }
  if (pdfKey)    downloadPdf(pdfKey);
  if (sentKey)   markAsSent(sentKey);
  if (cobrarKey) markSelectedCobrado(cobrarKey);

  if (toggleKey) {
    const panel = document.getElementById(`panel-${toggleKey}`);
    if (!panel) return;
    const open = panel.classList.toggle('open');
    btn.textContent = open ? '▲ Productos' : '▼ Productos';
  }
});

document.getElementById('cobradosList').addEventListener('click', async event => {
  const editKey   = event.target.getAttribute('data-edit-cobrado');
  const unmarkKey = event.target.getAttribute('data-unmark-cobrado');

  if (editKey) {
    const row = document.getElementById(`cobrado-row-${editKey}`);
    if (!row) return;
    const custCell = row.querySelector('.cobrado-customer');
    const descCell = row.querySelector('.cobrado-desc');

    if (event.target.textContent === 'Editar') {
      custCell.innerHTML = `<input class="inline-edit" value="${custCell.textContent.trim()}" />`;
      descCell.innerHTML = `<input class="inline-edit" value="${descCell.textContent.trim()}" />`;
      event.target.textContent = 'Guardar';
    } else {
      const newCustomer = custCell.querySelector('input').value;
      const newDesc     = descCell.querySelector('input').value;
      const res = await fetch(`${API_BASE}/api/edit-cobrado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guide_normalized: editKey, customerName: newCustomer, description: newDesc }),
      });
      if (res.ok) {
        const idx = allCobrados.findIndex(c => c.guide_normalized === editKey);
        if (idx !== -1) { allCobrados[idx].customerName = newCustomer; allCobrados[idx].description = newDesc; }
        renderCobrados();
      } else { alert('Error al guardar.'); }
    }
  }

  if (unmarkKey) {
    if (!confirm('¿Desmarcar este producto? Volverá a aparecer en futuras facturas.')) return;
    const res = await fetch(`${API_BASE}/api/unmark-cobrado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guide_normalized: unmarkKey }),
    });
    if (res.ok) {
      allCobrados = allCobrados.filter(c => c.guide_normalized !== unmarkKey);
      renderCobrados();
    } else { alert('Error al desmarcar.'); }
  }
});

els.historyList.addEventListener('click', event => {
  const btn = event.target.closest('[data-hist-preview],[data-hist-pdf]');
  if (!btn) return;

  const raw = btn.getAttribute('data-hist-preview') || btn.getAttribute('data-hist-pdf');
  let invoice;
  try { invoice = JSON.parse(raw); } catch { return; }

  if (btn.hasAttribute('data-hist-preview')) {
    renderInvoicePreview(invoice);
    els.invoiceDialog.showModal();
  } else {
    redownloadPdf(invoice);
  }
});

hydrateDefaultInputs();
setStatus('Esperando archivo…');
els.downloadZipBtn.disabled = true;
loadDownloadedInvoices();
loadCobrados();