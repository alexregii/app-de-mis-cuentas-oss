# Avisos de terceros

El repositorio publica código fuente y manifiestos de dependencias; no incluye
paquetes vendorizados ni imágenes OCI. Python instala las versiones fijadas en
`requirements.txt`; npm instala las del `frontend-react/package-lock.json`. Cada
distribución descargada conserva sus propios avisos y licencia en PyPI o npm.
El código del proyecto no sustituye esas licencias.

Dependencias directas fijadas en este candidato:

| Paquete | Versión | Licencia declarada |
| --- | --- | --- |
| Django | 5.2.15 | BSD-3-Clause |
| gunicorn | 23.0.0 | MIT |
| openpyxl | 3.1.5 | MIT |
| Pillow | 12.2.0 | MIT-CMU |
| whitenoise | 6.12.0 | MIT |
| PyJWT | 2.10.1 | MIT |
| requests | 2.32.5 | Apache-2.0 |
| @vitejs/plugin-react | 4.7.0 | MIT |
| React y React DOM | 19.2.7 | MIT |
| AG Charts Community, React y Locale | 14.0.2 | MIT |
| lucide-react | 0.468.0 | ISC |
| motion | 12.42.2 | MIT |
| uPlot | 1.6.32 | MIT |
| Vite | 6.4.5 | MIT |
| Playwright | 1.61.1 | Apache-2.0 |

El resto de herramientas directas de desarrollo (Testing Library, Vitest,
TypeScript y jsdom) también declaran MIT o Apache-2.0 en los metadatos de sus
paquetes. Las versiones exactas y las dependencias transitivas están en los
manifiestos fijados; no se copia su código fuente dentro de este repositorio.
Las licencias y atribuciones de los paquetes descargados permanecen junto a
cada distribución en npm o PyPI.

Los iconos de interfaz se importan desde `lucide-react` como dependencia npm.
La marca original de `frontend-react/public/brand/logo.svg` se vectorizó a
partir del icono previo de la aplicación; el mantenedor confirmó que tiene
derechos para incluir ese original y sus variantes en esta publicación. Los
PNG se generan desde el SVG con `frontend-react/scripts/render-brand-icons.mjs`.
Las capturas
de la guía son de la aplicación con movimientos sintéticos; no son imágenes de
bancos ni recursos de terceros.

La licencia ISC de `lucide-react` declara:

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Los Dockerfiles fijan las imágenes base por digest. Este proyecto no publica ni
redistribuye dichas imágenes; Docker las descarga al construir la instalación
del usuario. Consulta los avisos del proveedor de cada imagen y paquete en la
versión que descargue el motor de contenedores.
