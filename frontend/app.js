const API_BASE = 'http://127.0.0.1:8000';

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
  if (!state.invalidRows.length) {
    els.invalidRows.innerHTML = '<div class="empty">Sin filas inválidas.</div>';
    return;
  }

  els.invalidRows.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Fila</th>
          <th>Razón</th>
          <th>Datos</th>
        </tr>
      </thead>
      <tbody>
        ${state.invalidRows.map(row => `
          <tr>
            <td>${row.row_number}</td>
            <td>${row.reason}</td>
            <td>${Object.values(row.raw).filter(Boolean).join(' | ')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderPreviewTable() {
  if (!state.invoices.length) {
    els.previewTable.innerHTML = '<div class="empty">No hay datos procesados.</div>';
    return;
  }

  const settings = getSettings();

  const rows = state.invoices.flatMap(invoice =>
    invoice.items.map(item => {
      const totalCrc = item.total_crc != null
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

  els.previewTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Paquete</th>
          <th>Descripción</th>
          <th>Peso lb</th>
          <th>Precio/lb</th>
          <th>Total CRC</th>
        </tr>
      </thead>
      <tbody>
        ${rows.slice(0, 200).map(row => `
          <tr>
            <td>${row.customerName}</td>
            <td>${row.guide}</td>
            <td>${row.description}</td>
            <td>${row.weightLb}</td>
            <td>${row.pricePerLb != null ? moneyUSD(row.pricePerLb) : ''}</td>
            <td>${moneyCRC(row.totalCrc)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
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
    const totalCrc = invoice.total_crc != null
      ? Number(invoice.total_crc)
      : Math.round(Number(invoice.total_usd || 0) * settings.exchangeRate);

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
        <div class="invoice-actions">
          <button class="ghost" data-preview="${invoice.customerKey}">Vista previa</button>
          <button class="primary" data-pdf="${invoice.customerKey}">Descargar PDF</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderInvoicePreview(invoice) {
  const settings = getSettings();
  const totalCrc = invoice.total_crc != null
    ? Number(invoice.total_crc)
    : Math.round(Number(invoice.total_usd || 0) * settings.exchangeRate);

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

          <div class="arvox-header-grid">
            <div>
              <div class="arvox-label">CLIENTE</div>
              <div class="arvox-value">${invoice.customerName}</div>
            </div>
            <div>
              <div class="arvox-label">NÚMERO DE PAQUETE</div>
              <div class="arvox-value">${(invoice.guides || []).join(', ') || 'N/A'}</div>
            </div>
            <div>
              <div class="arvox-label">FECHA</div>
              <div class="arvox-value">${new Date().toLocaleDateString('es-CR')}</div>
            </div>
          </div>

          <div class="arvox-table">
            <div class="arvox-table-head arvox-row">
              <div>PAQUETE</div>
              <div>DESCRIPCIÓN</div>
              <div>PESO LB</div>
              <div>PRECIO LB</div>
              <div>TOTAL</div>
            </div>

            <div class="arvox-table-body">
              ${invoice.items.map(item => {
                const itemTotalCrc = item.total_crc != null
                  ? Number(item.total_crc)
                  : Math.round(Number(item.total_usd || 0) * settings.exchangeRate);

                return `
                  <div class="arvox-row">
                    <div>${(item.guides || []).join(', ') || 'N/A'}</div>
                    <div>${item.description}</div>
                    <div>${item.weight_lb ?? ''}</div>
                    <div>${item.price_per_lb != null ? moneyUSD(item.price_per_lb) : ''}</div>
                    <div>${moneyCRC(itemTotalCrc)}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <div class="arvox-summary">
            <div class="arvox-summary-line">
              <span>MONTO POR PESO</span>
              <strong>${moneyCRC(totalCrc)}</strong>
            </div>

            <div class="arvox-pay-row">
              <span class="arvox-pay-label">CANTIDAD A PAGAR</span>
              <span class="arvox-pay-box">${moneyCRC(totalCrc)}</span>
            </div>
          </div>

          <div class="arvox-footer">
            <div class="arvox-stamp-wrap">
              <div class="arvox-stamp">
                <div class="arvox-stamp-outer">
                  <div class="arvox-stamp-inner">
                    <div class="arvox-stamp-text">ARVOX COURIER</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="arvox-sinpe">
              <div class="arvox-sinpe-title">SINPE</div>
              <div class="arvox-sinpe-number">${settings.sinpeNumber}</div>
              <div class="arvox-sinpe-name">${settings.footerText}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
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

els.invoiceList.addEventListener('click', event => {
  const previewKey = event.target.getAttribute('data-preview');
  const pdfKey = event.target.getAttribute('data-pdf');

  if (previewKey) {
    const invoice = state.invoices.find(i => i.customerKey === previewKey);
    if (!invoice) return;
    renderInvoicePreview(invoice);
    els.invoiceDialog.showModal();
  }

  if (pdfKey) {
    downloadPdf(pdfKey);
  }
});

hydrateDefaultInputs();
setStatus('Esperando archivo…');
els.downloadZipBtn.disabled = true;