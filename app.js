/* Punto de Venta para tiendita — funciona sin internet, todo se guarda en el celular (IndexedDB).
   Pantallas: Vender, Inventario, Caja (turnos y cortes), Reportes, Ajustes. */
'use strict';
const VERSION = '1.2';

/* ============================== utilidades ============================== */
const $ = (id) => document.getElementById(id);
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const $$ = (n) => dinero.format(n || 0);
const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plano = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const hoy0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fechaHora = (t) => new Date(t).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const hora = (t) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const cantTxt = (c, u) => u === 'kg' ? (Math.round(c * 1000) / 1000) + ' kg' : String(c);

let avisoT = null;
function aviso(txt, ms = 2200) {
  const a = $('aviso'); a.textContent = txt; a.classList.remove('oculto');
  clearTimeout(avisoT); avisoT = setTimeout(() => a.classList.add('oculto'), ms);
}
let audio = null;
function pitido(ok = true) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1250 : 300; o.type = 'square'; g.gain.value = 0.06;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.25));
  } catch (e) { /* sin sonido */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 40, 60]);
}

/* ============================== base de datos ============================== */
let db;
function abrirDB() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('puntoDeVenta', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      const p = d.createObjectStore('productos', { keyPath: 'id' }); p.createIndex('codigo', 'codigo');
      const v = d.createObjectStore('ventas', { keyPath: 'id', autoIncrement: true }); v.createIndex('fecha', 'fecha'); v.createIndex('turno', 'turno');
      d.createObjectStore('turnos', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => { db = r.result; ok(); };
    r.onerror = () => mal(r.error);
  });
}
function tx(almacen, modo, fn) {
  return new Promise((ok, mal) => {
    const t = db.transaction(almacen, modo); let res;
    t.oncomplete = () => ok(res); t.onerror = () => mal(t.error); t.onabort = () => mal(t.error);
    res = fn(t);
  });
}
const pedir = (req) => new Promise((ok, mal) => { req.onsuccess = () => ok(req.result); req.onerror = () => mal(req.error); });
async function todosDe(almacen) { let r; await tx(almacen, 'readonly', (t) => { pedir(t.objectStore(almacen).getAll()).then((x) => { r = x; }); }); return r; }
async function guardar(almacen, obj) { let k; await tx(almacen, 'readwrite', (t) => { pedir(t.objectStore(almacen).put(obj)).then((x) => { k = x; }); }); return k; }
async function borrar(almacen, id) { await tx(almacen, 'readwrite', (t) => { t.objectStore(almacen).delete(id); }); }

/* productos en memoria (una tiendita tiene cientos o pocos miles: cabe de sobra) */
let productos = [];
const porCodigo = new Map();
async function cargarProductos() {
  productos = await todosDe('productos');
  productos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  porCodigo.clear();
  for (const p of productos) if (p.codigo) porCodigo.set(String(p.codigo), p);
}
async function guardarProducto(p) {
  p.precio = redondear(+p.precio || 0); p.costo = redondear(+p.costo || 0);
  p.existencias = +p.existencias || 0; p.minimo = +p.minimo || 0;
  await guardar('productos', p); await cargarProductos();
}

/* ============================== ajustes ============================== */
const AJ_DEF = { nombre: 'Mi Tiendita', dir: '', tel: '', pie: '¡Gracias por su compra!', impresora: false, ancho: 32, respaldo: 0 };
let aj = Object.assign({}, AJ_DEF, JSON.parse(localStorage.getItem('pdv.ajustes') || '{}'));
const guardarAjustes = () => localStorage.setItem('pdv.ajustes', JSON.stringify(aj));

/* ============================== navegación ============================== */
let pantalla = 'vender';
function ir(nombre) {
  pantalla = nombre;
  for (const s of ['vender', 'inventario', 'caja', 'reportes', 'ajustes']) $(s).classList.toggle('oculto', s !== nombre);
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('activo', b.dataset.ir === nombre);
  if (nombre !== 'vender') detenerCamara();   // la cámara solo vive en Vender: apagarla ahorra batería
  window.scrollTo(0, 0);
  ({ vender: pintarVender, inventario: pintarInventario, caja: pintarCaja, reportes: pintarReportes, ajustes: pintarAjustes })[nombre]();
}
document.querySelector('nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) ir(b.dataset.ir); });

/* ============================== ventanas ============================== */
function ventana(html, alAbrir) {
  const capa = $('capaVentana');
  capa.innerHTML = `<div class="velo"><div class="ventana">${html}</div></div>`;
  const velo = capa.firstElementChild;   // no se cierra al tocar fuera: se perderían datos o una lectura por accidente
  if (alAbrir) alAbrir(velo.firstElementChild);
  const f = velo.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 50);
  return velo.firstElementChild;
}
function cerrarVentana() { $('capaVentana').innerHTML = ''; if (pantalla === 'vender') reanudarCamara(); }
const ventanaAbierta = () => !!$('capaVentana').firstElementChild;
function confirmar(titulo, texto, si = 'Sí', peligro = false) {
  return new Promise((ok) => {
    ventana(`<h3>${esc(titulo)}</h3><p class="suave">${esc(texto)}</p>
      <div class="acciones"><button data-r="0">Cancelar</button><button data-r="1" class="${peligro ? 'peligro' : 'primario'}">${esc(si)}</button></div>`, (v) => {
      v.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { cerrarVentana(); ok(b.dataset.r === '1'); } });
    });
  });
}
function pedirNumero(titulo, texto, valor = '', paso = 'decimal') {
  return new Promise((ok) => {
    ventana(`<h3>${esc(titulo)}</h3><p class="suave">${esc(texto)}</p>
      <input id="vNum" type="number" inputmode="${paso}" step="any" value="${esc(valor)}" autofocus>
      <div class="acciones"><button data-r="0">Cancelar</button><button data-r="1" class="primario">Aceptar</button></div>`, (v) => {
      const fin = (r) => { const n = parseFloat($('vNum').value); cerrarVentana(); ok(r && !isNaN(n) ? n : null); };
      v.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) fin(b.dataset.r === '1'); });
      $('vNum').addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(true); });
    });
  });
}

/* ============================== cámara y lector de códigos ============================== */
let camara = { activa: false, stream: null, lector: null, ultimo: '', ultimoT: 0, destino: null, pausada: false, timer: null, detector: null };
async function iniciarCamara(destino) {
  camara.destino = destino;
  if (camara.activa) return;
  $('camaraCaja').classList.remove('oculto');
  $('camaraEstado').textContent = 'Abriendo cámara…';
  const video = $('video');
  try {
    if ('BarcodeDetector' in window) {
      const formatos = await BarcodeDetector.getSupportedFormats();
      camara.detector = new BarcodeDetector({ formats: formatos.filter((f) => ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'].includes(f)) });
      camara.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = camara.stream; await video.play();
      await acercar(camara.stream);
      camara.activa = true;
      const ciclo = async () => {
        if (!camara.activa) return;
        if (!camara.pausada && video.readyState >= 2) {
          try { const r = await camara.detector.detect(video); if (r.length) codigoLeido(r[0].rawValue); } catch (e) { /* sigue */ }
        }
        camara.timer = setTimeout(ciclo, 90);
      };
      ciclo();
    } else {
      camara.lector = new ZXing.BrowserMultiFormatReader();
      camara.activa = true;
      await camara.lector.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => { if (res && !camara.pausada) codigoLeido(res.getText()); });
    }
    $('camaraEstado').textContent = 'Apunta al código de barras';
  } catch (e) {
    detenerCamara();
    aviso(e && e.name === 'NotAllowedError' ? 'Da permiso de cámara en el navegador para escanear.' : 'No se pudo abrir la cámara.', 3500);
  }
}
// zoom 2x: los códigos chicos tienen más puntos y el celular puede quedar más lejos, donde enfoca mejor
async function acercar(stream) {
  try {
    const t = stream.getVideoTracks()[0], c = t.getCapabilities ? t.getCapabilities() : {};
    if (c.zoom) await t.applyConstraints({ advanced: [{ zoom: Math.min(2, c.zoom.max) }] });
  } catch (e) { /* sin zoom también funciona */ }
}
function detenerCamara() {
  camara.activa = false; clearTimeout(camara.timer);
  if (camara.lector) { try { camara.lector.reset(); } catch (e) {} camara.lector = null; }
  if (camara.stream) { camara.stream.getTracks().forEach((t) => t.stop()); camara.stream = null; }
  const v = $('video'); v.srcObject = null;
  $('camaraCaja').classList.add('oculto');
}
function pausarCamara() { camara.pausada = true; }
function reanudarCamara() { camara.pausada = false; }
function codigoLeido(codigo) {
  codigo = String(codigo).trim();
  const t = Date.now();
  if (codigo === camara.ultimo && t - camara.ultimoT < 1500) return;   // el mismo código seguido = una sola lectura
  camara.ultimo = codigo; camara.ultimoT = t;
  $('camaraEstado').textContent = 'Código leído: ' + codigo;
  if (ventanaAbierta()) return;
  if (camara.destino) camara.destino(codigo);
}
/* lectores físicos USB/Bluetooth: escriben el código muy rápido y terminan con Enter */
let teclas = '', teclasT = 0;
document.addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : document.body;
  const enCampo = el.matches('input, select, textarea') && el.id !== 'buscador';
  if (enCampo || ventanaAbierta()) return;
  const t = Date.now();
  if (t - teclasT > 60) teclas = '';
  teclasT = t;
  if (e.key === 'Enter' && teclas.length >= 4) {
    const c = teclas; teclas = ''; e.preventDefault();
    if (el.id === 'buscador') $('buscador').value = '';
    if (pantalla === 'vender') leerParaVenta(c); else if (pantalla === 'inventario') leerParaInventario(c);
    return;
  }
  if (e.key.length === 1) teclas += e.key;
});

/* ============================== VENDER ============================== */
let carrito = JSON.parse(localStorage.getItem('pdv.carrito') || '[]');   // [{id, nombre, precio, costo, unidad, cant}]
const guardarCarrito = () => localStorage.setItem('pdv.carrito', JSON.stringify(carrito));
const totalCarrito = () => redondear(carrito.reduce((s, l) => s + l.precio * l.cant, 0));

async function agregar(p, cant) {
  if (p.unidad === 'kg' && cant == null) {
    const n = await pedirNumero(p.nombre, `Precio por kilo: ${$$(p.precio)}. ¿Cuántos kilos? (ej. 0.5 = medio kilo)`, '', 'decimal');
    if (!n || n <= 0) return;
    cant = n;
  }
  cant = cant || 1;
  const l = carrito.find((x) => x.id === p.id && p.unidad !== 'kg');
  if (l) l.cant += cant;
  else carrito.push({ id: p.id, nombre: p.nombre, precio: p.precio, costo: p.costo || 0, unidad: p.unidad, cant });
  guardarCarrito(); pintarCarrito();
  if (p.existencias - cant < 0 && p.unidad !== 'kg') aviso(`Ojo: según el inventario no hay suficientes «${p.nombre}».`);
}
function leerParaVenta(codigo) {
  const p = porCodigo.get(codigo);
  if (p) { pitido(true); agregar(p); aviso('+ ' + p.nombre, 1200); }
  else { pitido(false); pausarCamara(); altaRapida(codigo); }
}
function altaRapida(codigo) {
  editarProducto({ codigo, unidad: 'pz', existencias: 0, minimo: 0 }, async (p) => { if (pantalla === 'vender') { await agregar(p); } }, `Producto nuevo (código ${codigo})`);
}
function pintarVender() { pintarRapidos(); pintarCarrito(); }
function pintarRapidos() {
  const favs = productos.filter((p) => p.favorito);
  $('rapidosCaja').classList.toggle('oculto', !favs.length);
  $('rapidos').innerHTML = favs.map((p) => `<button data-id="${esc(p.id)}">${esc(p.nombre)}<b>${$$(p.precio)}${p.unidad === 'kg' ? '/kg' : ''}</b></button>`).join('');
}
$('rapidos').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) { const p = productos.find((x) => x.id === b.dataset.id); if (p) agregar(p); } });
function pintarCarrito() {
  const ul = $('carrito');
  if (!carrito.length) ul.innerHTML = '<li class="vacio">Escanea o busca productos para empezar la venta.</li>';
  else ul.innerHTML = carrito.map((l, i) => `<li>
      <div class="nom"><div>${esc(l.nombre)}</div><div class="suave chico-t">${$$(l.precio)}${l.unidad === 'kg' ? ' / kg' : ''}</div></div>
      <div class="cant">${l.unidad === 'kg'
        ? `<button class="chico" data-kg="${i}">${cantTxt(l.cant, 'kg')}</button><button data-quitar="${i}" aria-label="Quitar">×</button>`
        : `<button data-menos="${i}" aria-label="Uno menos">−</button><span class="num mono">${l.cant}</span><button data-mas="${i}" aria-label="Uno más">+</button>`}</div>
      <div class="importe mono">${$$(l.precio * l.cant)}</div></li>`).join('');
  const n = carrito.reduce((s, l) => s + (l.unidad === 'kg' ? 1 : l.cant), 0);
  $('numArticulos').textContent = n ? `· ${n} artículo${n === 1 ? '' : 's'}` : '';
  $('total').textContent = $$(totalCarrito());
  $('btnCobrar').disabled = !carrito.length;
}
$('carrito').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.mas) carrito[+d.mas].cant++;
  if (d.menos) { const l = carrito[+d.menos]; l.cant--; if (l.cant <= 0) carrito.splice(+d.menos, 1); }
  if (d.quitar) carrito.splice(+d.quitar, 1);
  if (d.kg) { const l = carrito[+d.kg]; const n = await pedirNumero(l.nombre, '¿Cuántos kilos?', l.cant); if (n && n > 0) l.cant = n; }
  guardarCarrito(); pintarCarrito();
});
$('btnVaciar').addEventListener('click', async () => {
  if (carrito.length && await confirmar('¿Vaciar la venta?', 'Se quitan todos los productos de la venta actual.', 'Vaciar', true)) { carrito = []; guardarCarrito(); pintarCarrito(); }
});
/* búsqueda */
function buscar(txt, lista = productos) {
  const q = plano(txt).trim(); if (!q) return [];
  const pal = q.split(/\s+/);
  return lista.filter((p) => { const h = plano(p.nombre + ' ' + (p.codigo || '') + ' ' + (p.categoria || '')); return pal.every((w) => h.includes(w)); });
}
$('buscador').addEventListener('input', () => {
  const r = buscar($('buscador').value).slice(0, 30), caja = $('resultados');
  caja.classList.toggle('oculto', !$('buscador').value.trim());
  $('listaResultados').innerHTML = r.length ? r.map((p) => `<li data-id="${esc(p.id)}"><div class="nom"><div>${esc(p.nombre)}</div>
      <div class="suave chico-t">${esc(p.codigo || 'sin código')} · ${etiquetaExist(p)}</div></div><div class="importe mono">${$$(p.precio)}</div></li>`).join('')
    : '<li class="vacio">Sin resultados. Agrega el producto en Inventario.</li>';
});
$('buscador').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const v = $('buscador').value.trim(); if (!v) return;
  e.preventDefault();
  if (porCodigo.has(v)) { $('buscador').value = ''; $('resultados').classList.add('oculto'); leerParaVenta(v); return; }
  const r = buscar(v); if (r.length === 1) { agregar(r[0]); $('buscador').value = ''; $('resultados').classList.add('oculto'); }
  else if (/^\d{6,}$/.test(v)) { $('buscador').value = ''; $('resultados').classList.add('oculto'); leerParaVenta(v); }
});
$('listaResultados').addEventListener('click', (e) => {
  const li = e.target.closest('[data-id]'); if (!li) return;
  const p = productos.find((x) => x.id === li.dataset.id);
  if (p) { agregar(p); $('buscador').value = ''; $('resultados').classList.add('oculto'); }
});
$('btnCamara').addEventListener('click', () => { if (camara.activa) detenerCamara(); else iniciarCamara(leerParaVenta); });

/* cobrar */
$('btnCobrar').addEventListener('click', async () => {
  if (!carrito.length) return;
  if (!turnoActual) { aviso('Primero abre la caja.'); const ok = await abrirCaja(); if (!ok) return; }
  pausarCamara();
  const total = totalCarrito();
  let metodo = 'efectivo';
  const v = ventana(`<h3>Cobrar</h3><div class="grande mono">${$$(total)}</div>
    <div class="metodos"><button data-m="efectivo" class="activo">Efectivo</button><button data-m="tarjeta">Tarjeta</button><button data-m="transferencia">Transfer.</button></div>
    <div id="zonaEfectivo"><label for="vRecibido">¿Con cuánto paga?</label><input id="vRecibido" type="number" inputmode="decimal" step="any" placeholder="${total.toFixed(2)}" autofocus>
      <div class="billetes">${[0, 20, 50, 100, 200, 500].map((b) => `<button data-b="${b}">${b ? '$' + b : 'Exacto'}</button>`).join('')}</div>
      <div class="grande mono" id="vCambio" style="font-size:24px">Cambio: $0.00</div></div>
    <div class="acciones"><button data-r="0">Cancelar</button><button data-r="1" class="primario" id="vCobrarOk">Cobrar ${$$(total)}</button></div>`, (w) => {
    const calc = () => {
      const r = parseFloat($('vRecibido').value);
      const c = isNaN(r) ? 0 : redondear(r - total);
      $('vCambio').textContent = c < 0 ? 'Faltan ' + $$(-c) : 'Cambio: ' + $$(c);
      $('vCambio').style.color = c < 0 ? 'var(--peligro)' : '';
      $('vCobrarOk').disabled = metodo === 'efectivo' && !isNaN(r) && r < total;
    };
    $('vRecibido').addEventListener('input', calc);
    $('vRecibido').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('vCobrarOk').disabled) $('vCobrarOk').click(); });
    w.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.m) { metodo = b.dataset.m; for (const x of w.querySelectorAll('[data-m]')) x.classList.toggle('activo', x === b); $('zonaEfectivo').classList.toggle('oculto', metodo !== 'efectivo'); calc(); }
      if (b.dataset.b !== undefined) { $('vRecibido').value = +b.dataset.b === 0 ? total.toFixed(2) : b.dataset.b; calc(); }
      if (b.dataset.r === '0') cerrarVentana();
      if (b.dataset.r === '1') {
        const recibido = metodo === 'efectivo' ? (parseFloat($('vRecibido').value) || total) : total;
        const venta = await registrarVenta(metodo, recibido);
        mostrarTicket(venta, true);
      }
    });
  });
});
async function registrarVenta(metodo, recibido) {
  const total = totalCarrito();
  const venta = { fecha: Date.now(), turno: turnoActual.id, metodo, total, recibido: redondear(recibido), cambio: redondear(Math.max(0, recibido - total)),
    items: carrito.map((l) => ({ id: l.id, nombre: l.nombre, precio: l.precio, costo: l.costo, unidad: l.unidad, cant: l.cant })) };
  venta.id = await guardar('ventas', venta);
  for (const l of carrito) {   // descontar existencias
    const p = productos.find((x) => x.id === l.id);
    if (p) { p.existencias = redondear(p.existencias - l.cant); await guardar('productos', p); }
  }
  await cargarProductos();
  carrito = []; guardarCarrito(); pintarCarrito(); pintarEncabezado();
  const bajos = venta.items.map((i) => productos.find((p) => p.id === i.id)).filter((p) => p && p.minimo > 0 && p.existencias <= p.minimo);
  if (bajos.length) setTimeout(() => aviso('Por agotarse: ' + bajos.map((p) => p.nombre).join(', '), 4000), 600);
  return venta;
}

/* ============================== tickets ============================== */
function textoTicket(v) {
  const W = +aj.ancho || 32, linea = '-'.repeat(W);
  const centro = (s) => { s = String(s).slice(0, W); const e = Math.floor((W - s.length) / 2); return ' '.repeat(Math.max(0, e)) + s; };
  const dos = (a, b) => { a = String(a); b = String(b); const esp = W - b.length; return (a.length > esp - 1 ? a.slice(0, esp - 1) : a).padEnd(esp) + b; };
  const r = [centro(aj.nombre)];
  if (aj.dir) r.push(centro(aj.dir));
  if (aj.tel) r.push(centro('Tel. ' + aj.tel));
  r.push(linea, dos('Ticket #' + v.id, fechaHora(v.fecha)), linea);
  for (const i of v.items) {
    r.push(i.nombre.slice(0, W));
    r.push(dos('  ' + cantTxt(i.cant, i.unidad) + ' x ' + $$(i.precio), $$(i.precio * i.cant)));
  }
  r.push(linea, dos('TOTAL', $$(v.total)));
  if (v.metodo === 'efectivo') { r.push(dos('Efectivo', $$(v.recibido)), dos('Cambio', $$(v.cambio))); }
  else r.push(dos('Pago con', v.metodo === 'tarjeta' ? 'Tarjeta' : 'Transferencia'));
  if (v.cancelada) r.push('', centro('*** VENTA CANCELADA ***'));
  r.push(linea);
  if (aj.pie) r.push(centro(aj.pie));
  return r.join('\n');
}
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¡¿]/g, '');
function imprimir(texto) {
  // RawBT recibe el texto por su esquema de URL y lo manda a la impresora Bluetooth
  const b64 = btoa(unescape(encodeURIComponent(sinAcentos(texto) + '\n\n\n')));
  location.href = 'rawbt:base64,' + b64;
}
async function compartir(texto) {
  if (navigator.share) { try { await navigator.share({ text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
}
function mostrarTicket(v, recien = false) {
  const txt = textoTicket(v);
  ventana(`<h3>${recien ? 'Venta registrada' : 'Ticket #' + v.id}</h3>
    ${recien && v.metodo === 'efectivo' ? `<div class="grande mono" style="color:var(--verde)">Cambio: ${$$(v.cambio)}</div>` : ''}
    <pre class="ticket">${esc(txt)}</pre>
    <div class="fila"><button data-a="wa">WhatsApp</button>${aj.impresora ? '<button data-a="imp">Imprimir</button>' : ''}</div>
    ${!recien && !v.cancelada ? '<button data-a="cancelar" class="peligro" style="width:100%;margin-top:8px">Cancelar esta venta</button>' : ''}
    <div class="acciones"><button data-a="ok" class="primario">${recien ? 'Nueva venta' : 'Cerrar'}</button></div>`, (w) => {
    w.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'wa') compartir(txt);
      if (b.dataset.a === 'imp') imprimir(txt);
      if (b.dataset.a === 'ok') cerrarVentana();
      if (b.dataset.a === 'cancelar') { cerrarVentana(); await cancelarVenta(v); }
    });
  });
}
async function cancelarVenta(v) {
  if (!await confirmar('¿Cancelar la venta #' + v.id + '?', 'Se regresan los productos al inventario y la venta deja de contar en la caja y los reportes.', 'Cancelar venta', true)) return;
  v.cancelada = Date.now(); await guardar('ventas', v);
  for (const i of v.items) { const p = productos.find((x) => x.id === i.id); if (p) { p.existencias = redondear(p.existencias + i.cant); await guardar('productos', p); } }
  await cargarProductos(); aviso('Venta cancelada'); pintarEncabezado();
  if (pantalla === 'caja') pintarCaja(); if (pantalla === 'reportes') pintarReportes();
}

/* ============================== INVENTARIO ============================== */
let filtroInv = 'todos';
function etiquetaExist(p) {
  const e = cantTxt(p.existencias, p.unidad);
  if (p.existencias <= 0) return `<span class="etiqueta cero">Sin existencias</span>`;
  if (p.minimo > 0 && p.existencias <= p.minimo) return `<span class="etiqueta baja">Quedan ${e}</span>`;
  return `<span class="etiqueta">${e}</span>`;
}
function pintarInventario() {
  let lista = $('buscarInv').value.trim() ? buscar($('buscarInv').value) : productos.slice();
  if (filtroInv === 'bajos') lista = lista.filter((p) => p.existencias <= 0 || (p.minimo > 0 && p.existencias <= p.minimo));
  if (filtroInv === 'fav') lista = lista.filter((p) => p.favorito);
  const bajos = productos.filter((p) => p.existencias <= 0 || (p.minimo > 0 && p.existencias <= p.minimo)).length;
  const valor = productos.reduce((s, p) => s + Math.max(0, p.existencias) * (p.costo || 0), 0);
  $('resumenInv').textContent = `${productos.length} productos · ${bajos} por agotarse · inventario a costo: ${$$(valor)}`;
  $('listaInv').innerHTML = lista.length ? lista.slice(0, 300).map((p) => `<li data-id="${esc(p.id)}">
      <div class="nom"><div>${p.favorito ? '<b>★</b> ' : ''}${esc(p.nombre)}</div><div class="suave chico-t">${esc(p.codigo || 'sin código')}${p.categoria ? ' · ' + esc(p.categoria) : ''}</div></div>
      <div style="text-align:right"><div class="mono" style="font-weight:600">${$$(p.precio)}${p.unidad === 'kg' ? '/kg' : ''}</div>${etiquetaExist(p)}</div></li>`).join('')
    : `<li class="vacio">${productos.length ? 'Nada coincide.' : 'Aún no hay productos. Toca «+ Producto» o escanea uno nuevo desde Vender.'}</li>`;
}
$('buscarInv').addEventListener('input', pintarInventario);
$('filtrosInv').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]'); if (!b) return; filtroInv = b.dataset.f;
  for (const x of $('filtrosInv').children) x.classList.toggle('activo', x === b); pintarInventario();
});
$('listaInv').addEventListener('click', (e) => { const li = e.target.closest('[data-id]'); if (li) editarProducto(productos.find((p) => p.id === li.dataset.id)); });
$('btnNuevoProd').addEventListener('click', () => editarProducto({ unidad: 'pz', existencias: 0, minimo: 0 }));
function leerParaInventario(codigo) {
  const p = porCodigo.get(codigo);
  pitido(!!p);
  if (p) editarProducto(p); else editarProducto({ codigo, unidad: 'pz', existencias: 0, minimo: 0 }, null, `Producto nuevo (código ${codigo})`);
}
$('btnCamaraInv').addEventListener('click', () => {
  ir('vender'); iniciarCamara((c) => { detenerCamara(); ir('inventario'); leerParaInventario(c); }); aviso('Escanea el producto');
});
function editarProducto(p, alGuardar, titulo) {
  const nuevo = !p.id;
  pausarCamara();
  const w = ventana(`<h3>${esc(titulo || (nuevo ? 'Nuevo producto' : 'Editar producto'))}</h3>
    <label for="fNombre">Nombre</label><input id="fNombre" value="${esc(p.nombre || '')}" placeholder="Ej. Leche entera 1 L" autofocus>
    <label for="fCodigo">Código de barras</label><div class="fila"><input id="fCodigo" value="${esc(p.codigo || '')}" inputmode="numeric" placeholder="Opcional"><button class="no-crece" id="fEscanear">Escanear</button></div>
    <div class="fila"><div><label for="fPrecio">Precio de venta</label><input id="fPrecio" type="number" inputmode="decimal" step="any" value="${p.precio ?? ''}"></div>
      <div><label for="fCosto">Costo (lo que te cuesta)</label><input id="fCosto" type="number" inputmode="decimal" step="any" value="${p.costo ?? ''}"></div></div>
    <div class="fila"><div><label for="fExist">Existencias</label><input id="fExist" type="number" inputmode="decimal" step="any" value="${p.existencias ?? 0}"></div>
      <div><label for="fMin">Avisar cuando queden</label><input id="fMin" type="number" inputmode="decimal" step="any" value="${p.minimo ?? 0}"></div></div>
    <div class="fila"><div><label for="fUnidad">Se vende por</label><select id="fUnidad"><option value="pz">Pieza</option><option value="kg">Kilo (a granel)</option></select></div>
      <div><label for="fCat">Categoría</label><input id="fCat" value="${esc(p.categoria || '')}" placeholder="Ej. Lácteos" list="categorias"></div></div>
    <datalist id="categorias">${[...new Set(productos.map((x) => x.categoria).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label><input type="checkbox" id="fFav" style="width:auto;min-height:0;margin-right:8px" ${p.favorito ? 'checked' : ''}>Mostrar en «Productos rápidos» (para cosas sin código: tortillas, pan, dulces sueltos)</label>
    <div class="suave chico-t" id="fGanancia"></div>
    ${nuevo ? '' : '<button id="fBorrar" class="peligro" style="width:100%;margin-top:12px">Borrar producto</button>'}
    <div class="acciones"><button data-r="0">Cancelar</button><button data-r="1" class="primario">Guardar</button></div>`);
  $('fUnidad').value = p.unidad || 'pz';
  const gan = () => { const pr = +$('fPrecio').value, co = +$('fCosto').value; $('fGanancia').textContent = pr && co ? `Ganancia por ${$('fUnidad').value === 'kg' ? 'kilo' : 'pieza'}: ${$$(pr - co)} (${Math.round((pr - co) / pr * 100)}%)` : ''; };
  $('fPrecio').addEventListener('input', gan); $('fCosto').addEventListener('input', gan); gan();
  $('fEscanear').addEventListener('click', () => {
    const datos = leerForm(); cerrarVentana(); ir('vender');
    iniciarCamara((c) => { detenerCamara(); editarProducto(Object.assign(p, datos, { codigo: c }), alGuardar, titulo); if (pantalla !== 'inventario' && !alGuardar) ir('inventario'); });
  });
  if (!nuevo) $('fBorrar').addEventListener('click', async () => {
    cerrarVentana();
    if (await confirmar('¿Borrar «' + p.nombre + '»?', 'Las ventas pasadas se conservan en los reportes.', 'Borrar', true)) { await borrar('productos', p.id); await cargarProductos(); pintarInventario(); pintarRapidos(); aviso('Producto borrado'); }
  });
  function leerForm() {
    return { nombre: $('fNombre').value.trim(), codigo: $('fCodigo').value.trim(), precio: $('fPrecio').value, costo: $('fCosto').value, existencias: $('fExist').value,
      minimo: $('fMin').value, unidad: $('fUnidad').value, categoria: $('fCat').value.trim(), favorito: $('fFav').checked };
  }
  w.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === '0') { cerrarVentana(); return; }
    const d = leerForm();
    if (!d.nombre) { aviso('Escribe el nombre del producto'); $('fNombre').focus(); return; }
    if (!(+d.precio > 0)) { aviso('Escribe el precio de venta'); $('fPrecio').focus(); return; }
    if (d.codigo) { const otro = porCodigo.get(d.codigo); if (otro && otro.id !== p.id) { aviso('Ese código ya es de «' + otro.nombre + '»', 3500); return; } }
    Object.assign(p, d); if (!p.id) { p.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); p.creado = Date.now(); }
    await guardarProducto(p); cerrarVentana(); aviso('Guardado: ' + p.nombre);
    if (pantalla === 'inventario') pintarInventario(); pintarRapidos();
    if (alGuardar) alGuardar(p);
  });
}
/* entrada de mercancía: escanear o buscar y sumar existencias */
$('btnEntrada').addEventListener('click', () => entradaMercancia());
function entradaMercancia() {
  const w = ventana(`<h3>Entrada de mercancía</h3><p class="suave">Escanea o busca lo que llegó del proveedor y escribe cuántas piezas (o kilos) entraron.</p>
    <div class="fila"><input id="eBuscar" type="search" placeholder="Buscar o escribir código…" autofocus><button class="no-crece" id="eCamara">Escanear</button></div>
    <ul class="lista" id="eLista"></ul><div class="acciones"><button data-r="0" class="primario">Terminar</button></div>`, (v) => {
    const pintar = () => { const r = buscar($('eBuscar').value).slice(0, 20); $('eLista').innerHTML = r.map((p) => `<li data-id="${esc(p.id)}"><div class="nom"><div>${esc(p.nombre)}</div><div class="suave chico-t">${etiquetaExist(p)}</div></div><button class="chico">+ Entrada</button></li>`).join(''); };
    $('eBuscar').addEventListener('input', pintar);
    $('eBuscar').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const p = porCodigo.get($('eBuscar').value.trim()); if (p) sumar(p); } });
    $('eCamara').addEventListener('click', () => { cerrarVentana(); ir('vender'); iniciarCamara((c) => { detenerCamara(); ir('inventario'); const p = porCodigo.get(c); pitido(!!p); if (p) sumar(p, true); else { aviso('Ese código no está dado de alta'); leerParaInventario(c); } }); });
    v.addEventListener('click', (e) => { if (e.target.closest('[data-r]')) { cerrarVentana(); pintarInventario(); return; } const li = e.target.closest('[data-id]'); if (li) sumar(productos.find((p) => p.id === li.dataset.id)); });
  });
  async function sumar(p, volver) {
    const n = await pedirNumero('Entrada: ' + p.nombre, `Hay ${cantTxt(p.existencias, p.unidad)}. ¿Cuántas ${p.unidad === 'kg' ? 'kilos' : 'piezas'} llegaron?`, '', 'decimal');
    if (n && n > 0) { p.existencias = redondear(p.existencias + n); await guardarProducto(p); aviso(`${p.nombre}: ahora hay ${cantTxt(p.existencias, p.unidad)}`); }
    pintarInventario(); entradaMercancia();
  }
  return w;
}

/* ============================== CAJA (turnos y cortes) ============================== */
let turnoActual = null;
async function cargarTurno() {
  const ts = await todosDe('turnos');
  turnoActual = ts.find((t) => !t.cierre) || null;
}
function pintarEncabezado() {
  $('nombreTienda').textContent = aj.nombre || 'Mi Tiendita';
  $('estadoCaja').textContent = turnoActual ? 'Caja abierta' : 'Caja cerrada';
}
async function abrirCaja() {
  const n = await pedirNumero('Abrir caja', '¿Con cuánto efectivo empiezas? (el fondo para dar cambio)', '', 'decimal');
  if (n === null) return false;
  const t = { apertura: Date.now(), fondo: redondear(n), movimientos: [] };
  t.id = await guardar('turnos', t); turnoActual = t;
  pintarEncabezado(); if (pantalla === 'caja') pintarCaja(); aviso('Caja abierta');
  return true;
}
$('btnAbrirCaja').addEventListener('click', abrirCaja);
async function ventasDeTurno(id) {
  let r; await tx('ventas', 'readonly', (t) => { pedir(t.objectStore('ventas').index('turno').getAll(id)).then((x) => { r = x; }); }); return r;
}
function resumenTurno(t, ventas) {
  const ok = ventas.filter((v) => !v.cancelada), por = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const v of ok) por[v.metodo] += v.total;
  const salidas = t.movimientos.filter((m) => m.tipo === 'retiro').reduce((s, m) => s + m.monto, 0);
  const entradas = t.movimientos.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
  return { por, n: ok.length, total: ok.reduce((s, v) => s + v.total, 0), salidas, entradas, esperado: redondear(t.fondo + por.efectivo + entradas - salidas) };
}
async function pintarCaja() {
  $('cajaCerrada').classList.toggle('oculto', !!turnoActual);
  $('cajaAbierta').classList.toggle('oculto', !turnoActual);
  if (turnoActual) {
    const vs = await ventasDeTurno(turnoActual.id), r = resumenTurno(turnoActual, vs);
    $('turnoDesde').textContent = 'desde ' + fechaHora(turnoActual.apertura);
    $('cifrasCaja').innerHTML = [
      ['Ventas del turno', $$(r.total) + ` (${r.n})`], ['Efectivo esperado en caja', $$(r.esperado)],
      ['Fondo inicial', $$(turnoActual.fondo)], ['Ventas en efectivo', $$(r.por.efectivo)],
      ['Tarjeta', $$(r.por.tarjeta)], ['Transferencia', $$(r.por.transferencia)],
      ['Retiros / gastos', '− ' + $$(r.salidas)], ['Ingresos', '+ ' + $$(r.entradas)]
    ].map(([t, v]) => `<div class="cifra"><div class="v mono">${v}</div><div class="t">${t}</div></div>`).join('');
    $('listaMovs').innerHTML = turnoActual.movimientos.length ? turnoActual.movimientos.map((m) => `<li><div class="nom"><div>${m.tipo === 'retiro' ? '− Retiro / gasto' : '+ Ingreso'}${m.nota ? ': ' + esc(m.nota) : ''}</div>
      <div class="suave chico-t">${hora(m.fecha)}</div></div><div class="importe mono">${$$(m.monto)}</div></li>`).join('') : '<li class="vacio">Sin retiros ni ingresos.</li>';
    const ord = vs.slice().sort((a, b) => b.fecha - a.fecha);
    $('ventasTurno').innerHTML = ord.length ? ord.map(filaVenta).join('') : '<li class="vacio">Todavía no hay ventas en este turno.</li>';
  }
  const ts = (await todosDe('turnos')).filter((t) => t.cierre).sort((a, b) => b.cierre - a.cierre).slice(0, 30);
  $('listaCortes').innerHTML = ts.length ? ts.map((t) => `<li data-corte="${t.id}"><div class="nom"><div>${fechaHora(t.apertura)} → ${hora(t.cierre)}</div>
      <div class="suave chico-t">Contado ${$$(t.contado)} · ${t.diferencia === 0 ? 'cuadró exacto' : (t.diferencia > 0 ? 'sobraron ' : 'faltaron ') + $$(Math.abs(t.diferencia))}</div></div>
      <div class="importe mono">${$$(t.ventas)}</div></li>`).join('') : '<li class="vacio">Aún no hay cortes.</li>';
}
const filaVenta = (v) => `<li data-venta="${v.id}"><div class="nom"><div>#${v.id} · ${v.items.length} producto${v.items.length === 1 ? '' : 's'}${v.cancelada ? ' <span class="etiqueta cero">Cancelada</span>' : ''}</div>
  <div class="suave chico-t">${fechaHora(v.fecha)} · ${{ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }[v.metodo]}</div></div>
  <div class="importe mono" style="${v.cancelada ? 'text-decoration:line-through;opacity:.6' : ''}">${$$(v.total)}</div></li>`;
async function abrirVenta(id) { let v; await tx('ventas', 'readonly', (t) => { pedir(t.objectStore('ventas').get(id)).then((x) => { v = x; }); }); if (v) mostrarTicket(v); }
for (const ul of ['ventasTurno', 'historial']) $(ul).addEventListener('click', (e) => { const li = e.target.closest('[data-venta]'); if (li) abrirVenta(+li.dataset.venta); });
async function movimiento(tipo) {
  const n = await pedirNumero(tipo === 'retiro' ? 'Retiro o gasto' : 'Ingreso de efectivo', tipo === 'retiro' ? 'Dinero que sale de la caja (pago a proveedor, gasto, retiro).' : 'Dinero que entra a la caja sin ser venta.', '', 'decimal');
  if (!n || n <= 0) return;
  const nota = prompt('¿Para qué fue? (opcional)', '') || '';
  turnoActual.movimientos.push({ tipo, monto: redondear(n), nota, fecha: Date.now() });
  await guardar('turnos', turnoActual); pintarCaja();
}
$('btnRetiro').addEventListener('click', () => movimiento('retiro'));
$('btnIngreso').addEventListener('click', () => movimiento('ingreso'));
$('btnCorte').addEventListener('click', async () => {
  const vs = await ventasDeTurno(turnoActual.id), r = resumenTurno(turnoActual, vs);
  const contado = await pedirNumero('Corte de caja', `Cuenta el efectivo que hay en la caja. Debería haber ${$$(r.esperado)}.`, '', 'decimal');
  if (contado === null) return;
  const dif = redondear(contado - r.esperado);
  if (!await confirmar('¿Cerrar la caja?', `Esperado ${$$(r.esperado)} · contado ${$$(contado)} · ${dif === 0 ? 'cuadra exacto' : (dif > 0 ? 'sobran ' : 'faltan ') + $$(Math.abs(dif))}.`, 'Cerrar caja')) return;
  Object.assign(turnoActual, { cierre: Date.now(), contado: redondear(contado), esperado: r.esperado, diferencia: dif, ventas: redondear(r.total), porMetodo: r.por, numVentas: r.n });
  await guardar('turnos', turnoActual);
  const t = turnoActual; turnoActual = null; pintarEncabezado(); pintarCaja();
  mostrarCorte(t);
});
function textoCorte(t) {
  const W = +aj.ancho || 32, l = '-'.repeat(W);
  const dos = (a, b) => String(a).padEnd(W - String(b).length) + b;
  return [aj.nombre, 'CORTE DE CAJA', l, 'Abrio:  ' + fechaHora(t.apertura), 'Cerro:  ' + fechaHora(t.cierre), l,
    dos('Ventas (' + t.numVentas + ')', $$(t.ventas)), dos(' Efectivo', $$(t.porMetodo.efectivo)), dos(' Tarjeta', $$(t.porMetodo.tarjeta)), dos(' Transferencia', $$(t.porMetodo.transferencia)), l,
    dos('Fondo', $$(t.fondo)), ...t.movimientos.map((m) => dos((m.tipo === 'retiro' ? '- ' : '+ ') + (m.nota || m.tipo).slice(0, W - 14), $$(m.monto))),
    dos('Esperado', $$(t.esperado)), dos('Contado', $$(t.contado)), dos('Diferencia', $$(t.diferencia)), l].join('\n');
}
function mostrarCorte(t) {
  const txt = textoCorte(t);
  ventana(`<h3>Corte de caja</h3><pre class="ticket">${esc(txt)}</pre>
    <div class="fila"><button data-a="wa">Compartir</button>${aj.impresora ? '<button data-a="imp">Imprimir</button>' : ''}</div>
    <div class="acciones"><button data-a="ok" class="primario">Listo</button></div>`, (w) => w.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'wa') compartir(txt); if (b.dataset.a === 'imp') imprimir(txt); if (b.dataset.a === 'ok') cerrarVentana();
  }));
}
$('listaCortes').addEventListener('click', async (e) => { const li = e.target.closest('[data-corte]'); if (!li) return; const t = (await todosDe('turnos')).find((x) => x.id === +li.dataset.corte); if (t) mostrarCorte(t); });

/* ============================== REPORTES ============================== */
let periodo = 'hoy';
$('periodos').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; periodo = b.dataset.p; for (const x of $('periodos').children) x.classList.toggle('activo', x === b); pintarReportes(); });
async function pintarReportes() {
  const dia = 86400000, h0 = hoy0();
  const desde = periodo === 'hoy' ? h0 : periodo === '7' ? h0 - 6 * dia : periodo === '30' ? h0 - 29 * dia : new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  let vs; await tx('ventas', 'readonly', (t) => { pedir(t.objectStore('ventas').index('fecha').getAll(IDBKeyRange.lowerBound(desde))).then((x) => { vs = x; }); });
  const ok = vs.filter((v) => !v.cancelada);
  const total = ok.reduce((s, v) => s + v.total, 0);
  const costo = ok.reduce((s, v) => s + v.items.reduce((a, i) => a + (i.costo || 0) * i.cant, 0), 0);
  const sinCosto = ok.some((v) => v.items.some((i) => !i.costo));
  const por = { efectivo: 0, tarjeta: 0, transferencia: 0 }; for (const v of ok) por[v.metodo] += v.total;
  $('cifrasRep').innerHTML = [
    ['Vendido', $$(total)], ['Tickets', ok.length], ['Ticket promedio', $$(ok.length ? total / ok.length : 0)], ['Ganancia estimada' + (sinCosto ? '*' : ''), $$(total - costo)],
    ['Efectivo', $$(por.efectivo)], ['Tarjeta + transferencia', $$(por.tarjeta + por.transferencia)]
  ].map(([t, v]) => `<div class="cifra"><div class="v mono">${v}</div><div class="t">${t}</div></div>`).join('') +
    (sinCosto ? '<div class="suave chico-t" style="grid-column:1/-1">* Algunos productos no tienen costo capturado; su ganancia cuenta como el precio completo.</div>' : '');
  // ventas por día
  const dias = periodo === 'hoy' ? 1 : Math.round((h0 - desde) / dia) + 1, suma = new Array(dias).fill(0);
  for (const v of ok) { const i = Math.floor((v.fecha - desde) / dia); if (i >= 0 && i < dias) suma[i] += v.total; }
  const max = Math.max(1, ...suma);
  if (periodo === 'hoy') {   // hoy: por hora
    const hs = new Array(24).fill(0); for (const v of ok) hs[new Date(v.fecha).getHours()] += v.total;
    const ini = Math.max(0, Math.min(7, hs.findIndex((x) => x > 0))), m2 = Math.max(1, ...hs);
    const rango = hs.slice(ini, 23);
    $('barras').innerHTML = rango.map((x, i) => `<div title="${ini + i}:00 · ${$$(x)}" style="height:${x / m2 * 100}%"></div>`).join('');
    $('barrasEtq').innerHTML = rango.map((x, i) => `<span>${(ini + i) % 3 === 0 ? ini + i : ''}</span>`).join('');
    document.querySelector('#reportes h2').textContent = 'Ventas por hora';
  } else {
    $('barras').innerHTML = suma.map((x, i) => `<div title="${new Date(desde + i * dia).toLocaleDateString('es-MX')} · ${$$(x)}" style="height:${x / max * 100}%"></div>`).join('');
    $('barrasEtq').innerHTML = suma.map((x, i) => { const d = new Date(desde + i * dia); return `<span>${dias <= 7 || d.getDate() % 5 === 1 ? d.getDate() : ''}</span>`; }).join('');
    document.querySelector('#reportes h2').textContent = 'Ventas por día';
  }
  // lo más vendido
  const top = new Map();
  for (const v of ok) for (const i of v.items) { const t = top.get(i.id) || { nombre: i.nombre, cant: 0, importe: 0, unidad: i.unidad }; t.cant += i.cant; t.importe += i.precio * i.cant; top.set(i.id, t); }
  const lista = [...top.values()].sort((a, b) => b.importe - a.importe).slice(0, 10);
  $('topProductos').innerHTML = lista.length ? lista.map((t, i) => `<li><div class="nom"><div>${i + 1}. ${esc(t.nombre)}</div><div class="suave chico-t">${cantTxt(Math.round(t.cant * 1000) / 1000, t.unidad)} vendidos</div></div><div class="importe mono">${$$(t.importe)}</div></li>`).join('') : '<li class="vacio">Sin ventas en este periodo.</li>';
  const hist = vs.sort((a, b) => b.fecha - a.fecha).slice(0, 100);
  $('historial').innerHTML = hist.length ? hist.map(filaVenta).join('') : '<li class="vacio">Sin ventas en este periodo.</li>';
}

/* ============================== AJUSTES y respaldo ============================== */
function pintarAjustes() {
  $('aNombre').value = aj.nombre; $('aDir').value = aj.dir; $('aTel').value = aj.tel; $('aPie').value = aj.pie;
  $('aImpresora').checked = !!aj.impresora; $('aAncho').value = String(aj.ancho);
  $('ultimoRespaldo').textContent = aj.respaldo ? 'Último respaldo: ' + fechaHora(aj.respaldo) : 'Todavía no has guardado ningún respaldo.';
  $('version').textContent = 'Punto de Venta ' + VERSION + ' · funciona sin internet · tus datos se guardan solo en este celular';
}
$('btnGuardarAjustes').addEventListener('click', () => {
  Object.assign(aj, { nombre: $('aNombre').value.trim() || 'Mi Tiendita', dir: $('aDir').value.trim(), tel: $('aTel').value.trim(), pie: $('aPie').value.trim() });
  guardarAjustes(); pintarEncabezado(); aviso('Ajustes guardados');
});
$('aImpresora').addEventListener('change', () => { aj.impresora = $('aImpresora').checked; guardarAjustes(); });
$('aAncho').addEventListener('change', () => { aj.ancho = +$('aAncho').value; guardarAjustes(); });
function descargar(nombre, contenido, tipo) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([contenido], { type: tipo })); a.download = nombre;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const fechaArchivo = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
$('btnExportar').addEventListener('click', async () => {
  const datos = { app: 'punto-de-venta', version: VERSION, fecha: Date.now(), ajustes: aj, productos: await todosDe('productos'), ventas: await todosDe('ventas'), turnos: await todosDe('turnos') };
  const json = JSON.stringify(datos), nombre = `respaldo-tienda-${fechaArchivo()}.json`;
  const archivo = new File([json], nombre, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {   // en el celular: mandarlo por correo, WhatsApp, Drive…
    try { await navigator.share({ files: [archivo], title: 'Respaldo de la tienda' }); } catch (e) { if (e.name !== 'AbortError') descargar(nombre, json, 'application/json'); }
  } else descargar(nombre, json, 'application/json');
  aj.respaldo = Date.now(); guardarAjustes(); pintarAjustes();
});
$('btnImportar').addEventListener('click', () => $('archivoImportar').click());
$('archivoImportar').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  let d; try { d = JSON.parse(await f.text()); } catch (x) { aviso('Ese archivo no es un respaldo válido'); return; }
  if (d.app !== 'punto-de-venta') { aviso('Ese archivo no es un respaldo de esta app'); return; }
  if (!await confirmar('¿Restaurar el respaldo?', `Del ${fechaHora(d.fecha)}: ${d.productos.length} productos, ${d.ventas.length} ventas. Se reemplaza TODO lo que hay ahora en este celular.`, 'Restaurar', true)) return;
  await tx(['productos', 'ventas', 'turnos'], 'readwrite', (t) => {
    for (const a of ['productos', 'ventas', 'turnos']) { const s = t.objectStore(a); s.clear(); for (const x of d[a]) s.put(x); }
  });
  aj = Object.assign({}, AJ_DEF, d.ajustes); guardarAjustes();
  await iniciar(); aviso('Respaldo restaurado');
});
$('btnCSV').addEventListener('click', () => {
  const c = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const filas = [['Codigo', 'Nombre', 'Categoria', 'Unidad', 'Precio', 'Costo', 'Existencias', 'Minimo'].join(',')]
    .concat(productos.map((p) => [c(p.codigo), c(p.nombre), c(p.categoria), p.unidad, p.precio, p.costo, p.existencias, p.minimo].join(',')));
  descargar(`inventario-${fechaArchivo()}.csv`, '﻿' + filas.join('\r\n'), 'text/csv');
});
$('btnBorrarTodo').addEventListener('click', async () => {
  if (!await confirmar('¿Borrar TODOS los datos?', 'Se borran productos, ventas y cortes de este celular. Haz un respaldo antes. No se puede deshacer.', 'Borrar todo', true)) return;
  if (prompt('Para confirmar escribe BORRAR') !== 'BORRAR') return;
  await tx(['productos', 'ventas', 'turnos'], 'readwrite', (t) => { for (const a of ['productos', 'ventas', 'turnos']) t.objectStore(a).clear(); });
  carrito = []; guardarCarrito(); await iniciar(); aviso('Datos borrados');
});
$('btnEjemplo').addEventListener('click', async () => {
  if (productos.length && !await confirmar('¿Agregar productos de ejemplo?', 'Se suman a los que ya tienes.', 'Agregar')) return;
  const ej = [
    ['7500000000011', 'Refresco de cola 600 ml', 'Bebidas', 18, 13, 24, 6], ['7500000000028', 'Agua natural 1 L', 'Bebidas', 12, 7.5, 30, 6],
    ['7500000000035', 'Leche entera 1 L', 'Lácteos', 28, 23, 12, 4], ['7500000000042', 'Yogur bebible fresa 250 g', 'Lácteos', 14, 10, 10, 3],
    ['7500000000059', 'Pan blanco de caja', 'Panadería', 46, 38, 6, 2], ['7500000000066', 'Galletas de chocolate', 'Botanas', 22, 16, 15, 4],
    ['7500000000073', 'Papas fritas sal 45 g', 'Botanas', 19, 14, 20, 5], ['7500000000080', 'Sopa de pasta 200 g', 'Abarrotes', 11, 8, 25, 6],
    ['7500000000097', 'Arroz 1 kg (bolsa)', 'Abarrotes', 32, 26, 10, 3], ['7500000000103', 'Aceite vegetal 1 L', 'Abarrotes', 45, 38, 8, 2],
    ['7500000000110', 'Atún en agua 140 g', 'Enlatados', 24, 18, 12, 4], ['7500000000127', 'Jabón de barra', 'Limpieza', 17, 12, 14, 4],
    ['7500000000134', 'Detergente en polvo 500 g', 'Limpieza', 29, 22, 9, 3], ['7500000000141', 'Papel higiénico 4 rollos', 'Limpieza', 38, 30, 7, 2],
    ['7500000000158', 'Café soluble 50 g', 'Abarrotes', 42, 33, 6, 2], ['7500000000165', 'Chiles en vinagre 220 g', 'Enlatados', 21, 15, 10, 3]
  ];
  const t0 = Date.now();
  for (let i = 0; i < ej.length; i++) { const [codigo, nombre, categoria, precio, costo, existencias, minimo] = ej[i];
    await guardar('productos', { id: 'p' + (t0 + i).toString(36), codigo, nombre, categoria, precio, costo, existencias, minimo, unidad: 'pz', favorito: false, creado: t0 }); }
  const sueltos = [['Tortillas', 'Tortillería', 24, 18, 20, 'kg'], ['Huevo', 'Abarrotes', 48, 40, 15, 'kg'], ['Frijol negro', 'Granel', 38, 30, 10, 'kg'], ['Azúcar', 'Granel', 30, 24, 12, 'kg'], ['Bolillo', 'Panadería', 3, 2, 40, 'pz'], ['Dulce suelto', 'Dulces', 2, 1, 100, 'pz']];
  for (let i = 0; i < sueltos.length; i++) { const [nombre, categoria, precio, costo, existencias, unidad] = sueltos[i];
    await guardar('productos', { id: 'p' + (t0 + 100 + i).toString(36), codigo: '', nombre, categoria, precio, costo, existencias, minimo: unidad === 'kg' ? 3 : 10, unidad, favorito: true, creado: t0 }); }
  await cargarProductos(); aviso('Se agregaron ' + (ej.length + sueltos.length) + ' productos de ejemplo'); pintarAjustes();
});

/* instalar como app (pantalla de inicio) */
let promptInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalar = e; $('btnInstalar').classList.remove('oculto'); });
$('btnInstalar').addEventListener('click', async () => { if (!promptInstalar) return; promptInstalar.prompt(); await promptInstalar.userChoice; promptInstalar = null; $('btnInstalar').classList.add('oculto'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
/* pedir al navegador que no borre los datos aunque falte espacio */
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ============================== inicio ============================== */
async function iniciar() {
  await cargarProductos(); await cargarTurno(); pintarEncabezado(); ir(pantalla);
  // recordatorio de respaldo si hay ventas y pasaron más de 7 días
  if (productos.length && (!aj.respaldo || Date.now() - aj.respaldo > 7 * 86400000)) setTimeout(() => aviso('Recuerda guardar un respaldo en Ajustes', 3500), 1500);
}
abrirDB().then(iniciar).catch((e) => { document.body.innerHTML = '<p style="padding:20px">No se pudo abrir la base de datos de este navegador: ' + esc(e && e.message) + '</p>'; });
