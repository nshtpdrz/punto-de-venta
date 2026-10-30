# Punto de Venta

Punto de venta para una tiendita de abarrotes que funciona en un celular, sin internet.
Proyecto de upcycling: darle una segunda vida a un celular viejo como caja registradora.

- **Vender:** escaneo de códigos con la cámara o con un lector USB/Bluetooth, búsqueda por nombre,
  productos rápidos y venta a granel por kilo. Cobro en efectivo (con cambio), tarjeta o transferencia.
- **Inventario:** existencias que bajan con cada venta, aviso de productos por agotarse,
  alta rápida al escanear un código nuevo y entrada de mercancía.
- **Caja:** apertura con fondo, retiros e ingresos, y corte con la diferencia contra lo contado.
- **Reportes:** ventas por día y por hora, lo más vendido y la ganancia estimada.
- **Tickets:** por WhatsApp o impresos en una mini impresora térmica Bluetooth (con la app RawBT).
- **Respaldo:** exportar e importar todos los datos en un archivo.

Todos los datos (productos, ventas, cortes) se guardan **solo en el celular** (IndexedDB);
este repositorio contiene únicamente el código de la app.

## Usarlo

Abre la página publicada en Chrome del celular y elige **Ajustes → Instalar en la pantalla de inicio**
(o en el menú de Chrome: «Agregar a la pantalla principal»). Después abre sin internet.

## Créditos

- Lectura de códigos de barras: [ZXing for JS](https://github.com/zxing-js/library) (Apache License 2.0), en `lib/zxing.min.js`.

## Actualizar la app

La app se guarda en el celular para funcionar sin internet. Al cambiar cualquier archivo, sube también
el número de `VERSION` en `sw.js` (por ejemplo `pdv-1.1`); así los celulares descargan la versión nueva
la próxima vez que abran la app con internet.
