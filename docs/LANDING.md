# Landing de Ultrasongs

Landing estática para GitHub Pages, independiente de la aplicación Next.js y de Python.

- Español: `docs/index.html` (ruta pública `/ultrasongs/`).
- Inglés: `docs/en/index.html` (ruta pública `/ultrasongs/en/`).
- Contenido y plantilla: `scripts/build-landing.mjs`.
- Estilos y comportamiento: `docs/assets/landing.css` y `docs/assets/landing.js`.
- Capturas reales: `docs/screenshots/es` y `docs/screenshots/en`.

## Editar y previsualizar

Editar el generador para cambiar textos o HTML. No editar directamente los HTML generados.

```sh
node scripts/build-landing.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory docs
```

Abrir http://127.0.0.1:8766/ o http://127.0.0.1:8766/en/.
No requiere instalar dependencias ni compilar la aplicación.

El idioma se elige mediante enlaces ES/EN; español es la portada por defecto. Ambas páginas contienen su contenido completo sin JavaScript. La galería muestra todas las capturas si JavaScript está desactivado. Con JavaScript se habilitan el selector de capturas y su ampliación (cerrar con Escape o el botón ×).

## Publicar en GitHub Pages

1. En GitHub, abrir **Settings → Pages → Build and deployment → Source** y elegir **Deploy from a branch**.
2. Elegir la rama `master` y la carpeta `/docs`. Generar los HTML con `node scripts/build-landing.mjs` antes de subir cambios. GitHub Pages publica automáticamente los cambios enviados a esa rama.
3. La URL prevista es https://pablopramparo.github.io/ultrasongs/.

La publicación sirve únicamente `docs`: no instala dependencias de la aplicación ni incluye configuraciones locales, audio, borradores o servicios de Python. Los HTML generados están versionados; no se necesita un workflow personalizado.

Los botones de descarga apuntan a la página de Releases: no suponen un nombre de instalador ni una versión existente. Si se cambia el propietario, repositorio o dominio, actualizar `repo` y `site` en el generador para mantener enlaces, canonical y hreflang correctos.

