---
author: Tommy CardeLo
pubDatetime: 2026-10-15T11:00:00Z
title: "Versavi — Una tienda para aretes de madera pintados a mano, sin framework y sin paso de build"
featured: false
draft: false
tags:
  - javascript
  - firebase
  - n8n
  - github-actions
  - playwright
  - web-design
lang: es
description: "Cómo construí una tienda estática y sin dependencias para Versavi, una pequeña marca artesanal: catálogo por estaciones, carrito por correo, formularios en n8n para que la dueña gestione sus piezas y un inventario de placeholders para reunir el contenido real."
---

> Una tienda estática para Versavi, una pequeña marca de aretes de madera pintados a mano: HTML, CSS y JS planos sin paso de build, un catálogo tipo "guía de campo" por estaciones, un carrito que envía un solo correo prefabricado y formularios en n8n con los que la dueña agrega, edita y borra piezas por su cuenta.

Sitio: [versavi.store](https://versavi.store)

---

## El problema

Una marca artesanal de una sola persona vive en Instagram, pero Instagram es un mal catálogo. No hay precios estables, no se puede explorar por temática y cada venta empieza con un hilo de mensajes directos. La dueña necesitaba tres cosas: un lugar al que dirigir a la gente, una forma de recibir pedidos sin que yo estuviera en medio y una manera de seguir ampliando el catálogo sin pagarme por cada par de aretes nuevo.

Las restricciones lo definieron todo. El tráfico es pequeño, el presupuesto es casi cero y quien mantiene el contenido es una artista, no una desarrolladora. Así que la pregunta real nunca fue "qué framework", sino "cuál es la mínima maquinaria que aún se sienta como una marca cuidada".

## Qué hace

- **Página de inicio** con un jardín animado guiado por el scroll que recorre las cuatro estaciones, seguido de un bloque por estación generado desde el catálogo.
- **Tienda y fichas de producto**: una cuadrícula filtrable (`?season=`) y una ficha con galería de fotos y selector de diseño para las piezas que tienen varias variantes.
- **Carrito** compartido por todas las páginas. Vive en `localStorage` y se convierte en un pedido por correo ya redactado.
- **Sección de pedidos personalizados**, porque las piezas por encargo forman parte de la oferta.
- **Páginas legales, 404, sitemap y vistas previas para redes**, añadidos en una pasada con una lista de verificación de lanzamiento.
- **Dos formularios en n8n** con los que la dueña sube, edita y borra piezas sin tocar código.

## Arquitectura

```
Navegador
  index.html / shop.html / product.html
    ├─ catalog-data.js   JSON estricto: slug, nombre, precio, estación, fotos/diseños
    ├─ catalog.js        tarjetas + reveal + control de caché
    ├─ cart.js           localStorage → un pedido por mailto:
    └─ garden.js         hero de cuatro estaciones, guiado por el scroll

Dueña (teléfono)
  formulario n8n ──► valida ──► reduce fotos a webp
                 ──► un solo commit a main (fotos + catalog-data.js + sitemap.xml)
                          │
                          ▼
        GitHub Actions ──► Firebase Hosting (dominio propio, SSL)
```

Todo el sitio es una carpeta de archivos estáticos. No hay bundler, ni gestor de paquetes, ni dependencias que actualizar. El catálogo es un único arreglo JSON asignado a `window.VERSA_RAW`, y todas las páginas se renderizan a partir de él.

## Decisiones de diseño clave

### 1. Archivos estáticos, a propósito

Para un sitio de este tamaño, un framework añadiría sobre todo cosas que pueden romperse. HTML estático en el plan gratuito de Firebase Hosting no cuesta nada, responde rápido y no hay nada que parchear. Medí una visita completa a la home en aproximadamente 1 MB, lo que cabe de sobra en la cuota gratuita para el tráfico que esta marca puede esperar. El camino de salida es claro: pasar a un plan de pago solo si necesito un backend, por ejemplo para pagos reales, o si el tráfico se acerca al límite.

### 2. Dirección de diseño: una guía de campo por estaciones

La marca pinta sobre pequeños círculos de madera, y las piezas se agrupan de forma natural por estación (fruta y mar en verano, flores en primavera). Así que el sitio se volvió una guía de campo de un jardín: cada pieza aparece como un espécimen sobre el color de su estación, recortada en el círculo de madera y con una etiqueta colgante.

Mantuve la paleta y la tipografía originales (verde azulado, terracota y crema, Baloo 2 con Nunito Sans) en lugar de rediseñar alrededor del logo. Fue un compromiso deliberado: la clienta ya había aprobado ese aspecto, y un sitio coherente vale más que uno teóricamente mejor que haya que aprobar de nuevo. La última pasada de rediseño quitó cosas que se habían ido acumulando, como una marquesina y algunas criaturas decorativas, y dejé etiquetada la versión anterior en git para poder recuperar cualquier parte.

### 3. Los pedidos salen como un correo, no por un checkout

Un checkout real implica un proveedor de pagos, un backend y trabajo de cumplimiento normativo. Para una vendedora que confirma envío y pago personalmente, nada de eso se justifica todavía. El carrito reúne las piezas, el nombre del cliente, un contacto y una dirección opcional, y arma un solo mensaje `mailto:`. La dueña responde con el total final y sus opciones de pago.

Es honesto con sus límites: la página avisa de que se abrirá la aplicación de correo y muestra la dirección como alternativa si no se abre. El carrito también sobrevive a navegadores que bloquean el almacenamiento: recurre a la memoria en lugar de lanzar un error.

### 4. Que la dueña publique sin mí

Lo más útil no fue visual. Reemplacé el "envíame las fotos y yo las subo" por dos formularios en n8n: uno para subir una pieza (nombre, precio, estación, descripción y de 1 a 6 fotos) y otro para editar o borrar las existentes. Cada envío valida los datos, convierte las fotos a webp de tamaño acotado (corrigiendo la orientación del teléfono) y hace **un solo commit** a `main` mediante la API de GitHub. Ese commit incluye las imágenes, el catálogo actualizado y el sitemap, y el CI lo despliega.

Un commit por cambio mantiene el historial legible y hace que cada cambio sea reversible. También impuso una regla que me gusta: `catalog-data.js` debe seguir siendo JSON estricto, porque lo escribe una máquina además de una persona. Del lado del sitio, `build()` descarta cualquier pieza con slug, precio o estación inválidos y registra una advertencia, de modo que una entrada errónea no pueda tumbar la página. Las fotos se guardan en caché una semana, así que cada edición añade un parámetro de versión a las URL de las imágenes.

### 5. Un inventario de placeholders para el contenido real

La primera versión salió con recuadros rayados de "foto pendiente", un "número por confirmar" en el pie de página y precios que yo había inventado para el diseño. Si se dejan solos, los placeholders terminan en producción. Por eso los traté como un inventario: un documento que lista cada placeholder, dónde aparece en el sitio y la pregunta o el archivo exacto que hace falta para reemplazarlo (canales de contacto, datos de la biografía, precios reales, envíos y pagos, devoluciones, además de una lista de fotos con notas técnicas para quien las tome).

Cuando llegaron las respuestas, las apliqué de una sola vez: un catálogo real, condiciones reales de envío y pago, y el alcance verdadero del trabajo de la marca. Más tarde eliminé por completo los recuadros de "foto pendiente" del sitio en vivo, de modo que el contenido sin terminar se oculta en lugar de verse roto. Dos vacíos quedan a propósito, un retrato de la dueña y fotos del proceso, y el sitio usa sustitutos hasta que lleguen.

### 6. Rendimiento y SEO, con una cifra honesta

Una lista de verificación de lanzamiento cubrió URL canónicas (incluida una redirección 301 de `www` al dominio principal), vistas previas Open Graph, sitemap y robots, una página 404, páginas legales y contraste AA. Una corrida local de Lighthouse dio 93 en rendimiento y 100 en accesibilidad, buenas prácticas y SEO. El Largest Contentful Paint ronda los 3,2 s por la animación de entrada del hero, y acepté ese compromiso a conciencia. No instalé analítica, lo que además evita la necesidad de un banner de cookies. El sitio está solo en inglés, pensado para clientes de habla inglesa.

## Pruebas

Todo se verifica con pruebas end-to-end en Playwright (Python): 196 comprobaciones sobre los tres tipos de página, incluyendo visibilidad del contenido, un catálogo roto a propósito, los botones de estación y el re-renderizado de la ficha de producto. Un E2E aparte maneja los formularios de n8n contra producción: publica una pieza de prueba, la edita, la borra y comprueba que el catálogo y el sitemap queden idénticos a como empezaron, sin que se envíe ningún correo a la clienta. Los reportes y las capturas se guardan como artefactos.

## Lo que aprendí

- Un CSS viejo en caché rompió una vez el jardín animado. Con hosting estático, conviene definir desde el principio las cabeceras de caché por tipo de archivo: largas para imágenes y `no-cache` para HTML, CSS y JS.
- Una librería de scroll suave que probé provocaba un rebote en una sección, así que la descarté. El `scroll-behavior` nativo fue suficiente.
- La deriva de alcance es real. Yo había generalizado el texto a "joyería" antes de que la biografía de la propia dueña fijara el alcance verdadero. Hay que tomar las palabras de la clienta como fuente de verdad.
- La mejor "funcionalidad" fue sacarme a mí del flujo de contenido.

## Qué sigue

Fotos reales para las colecciones que faltan, el retrato de la dueña y fotos del proceso, además de confirmar los textos de muestra que aún no ha revisado. Si el tráfico crece, lo primero que habrá que vigilar es el clip de video de la home, porque es lo que más peso añade por visita.

## Stack

HTML · CSS · JavaScript vanilla · Firebase Hosting (plan gratuito, dominio propio) · GitHub Actions · n8n (autoalojado, formularios y API de GitHub) · Playwright (Python) · Lighthouse
