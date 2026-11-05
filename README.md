# Trazo

Sketching 3D para iPad con Apple Pencil. Cada trazo es un objeto 3D independiente — un tubo o una cinta con grosor variable según la presión — no la deformación de un bloque como en las apps de escultura. Inspirado en Putty3D y Gravity Sketch.

Es una web app (Three.js + Vite) que corre en Safari del iPad y se puede instalar en la pantalla de inicio ("Compartir → Agregar a inicio") para usarla a pantalla completa.

## Cómo se dibuja en 3D desde una pantalla 2D

Cada trazo se proyecta sobre un **plano de dibujo** que se ve como una grilla azul:

| Plano | Qué hace |
| --- | --- |
| **Vista** | Plano de frente a la cámara, pasando por el centro de la órbita. |
| **Frente / Lado / Suelo** | Planos fijos XY / YZ / XZ. |
| **Superficie** | El trazo se pega a la superficie de los trazos existentes. |

- **Profundidad** mueve el plano hacia adelante o atrás.
- **Anclar** (activado por defecto): si empezás un trazo encima de otro, el plano salta hasta ese punto, así los trazos se conectan en 3D.
- **Fijar** congela el plano actual para poder girar la cámara y seguir dibujando sobre el mismo plano visto de costado.
- **Espejo**: simetría en X.

El grosor está en píxeles de pantalla: si acercás la cámara, dibujás más fino en el mundo, así que podés hacer detalle acercándote.

## Gestos

| Entrada | Acción |
| --- | --- |
| Apple Pencil | Dibujar / borrar (con presión; hover muestra el cursor 3D en iPads compatibles) |
| 1 dedo | Girar la cámara |
| 2 dedos | Mover + pellizcar para acercar |
| Toque con 2 dedos | Deshacer |
| Toque con 3 dedos | Rehacer |

Mientras el Pencil está apoyado se ignoran los toques de la palma. Sin Pencil, activá "Dibujar con el dedo" en el menú `⋯`.

Con mouse/teclado: clic izquierdo dibuja, clic derecho gira, Shift/medio mueve, rueda acerca. Atajos: `B` dibujar, `E` borrar, `1`–`5` planos, `M` espejo, `L` fijar, `[` `]` grosor, `⌘Z` / `⇧⌘Z`.

## Archivos

El boceto se guarda solo en el navegador. Desde el menú `⋯`:

- **Ver en AR / USDZ**: en iPad abre AR Quick Look para poner el boceto en la habitación.
- **GLB / OBJ**: para Blender, Nomad, Procreate Dreams, etc.
- **Guardar / Abrir boceto**: formato `.trazo.json` editable.

## Desarrollo

```bash
npm install
npm run dev      # abre en http://localhost:5173 y en la red local (--host)
npm test
npm run build
```

Para probar en el iPad: `npm run dev`, y abrí en Safari la URL de red que imprime Vite (mismo Wi-Fi).

## Código

- `src/strokeGeometry.ts` — geometría pura: tubo con marco sin torsión y radio variable, cinta plana, presión → radio.
- `src/sketch.ts` — trazos, mallas, deshacer/rehacer y guardado.
- `src/orbit.ts` — cámara orbital manejada por nuestros gestos (el Pencil nunca mueve la cámara).
- `src/main.ts` — escena, plano de dibujo, entrada (pen / touch / mouse) e interfaz.
- `src/exporters.ts` — GLB, OBJ, USDZ y JSON (se cargan bajo demanda).
