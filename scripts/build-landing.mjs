import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const repo = "https://github.com/pablopramparo/ultrasongs";
const site = "https://pablopramparo.github.io/ultrasongs/";
const messages = {
  es: {
    title: "Ultrasongs — De una canción a Ultrastar",
    description: "Convertí audio y letras en canciones para Ultrastar. IA local, un editor visual y el control en tus manos. Gratis y de código abierto.",
    skip: "Saltar al contenido", nav: ["Características", "Cómo funciona", "Descarga"],
    eyebrow: "CREÁ. SINCRONIZÁ. CANTÁ.", hero: 'De una canción<br>a <span class="gradient">Ultrastar.</span>',
    intro: "Esa canción que querés cantar.<br>Ahora también la podés crear.",
    lead: "Convertí audio y letras en canciones listas para jugar. Con ayuda de IA, edición visual y control total sobre el resultado.",
    download: "Descargar para Windows", github: "Ver en GitHub", note: "Gratis · Windows 10/11 · Código abierto",
    first: "La primera ejecución descarga los modelos de IA (varios GB).",
    preview: "EL ESCENARIO ES TUYO", previewLabel: "Vista del editor de notas de Ultrasongs",
    features: [
      ["music", "Importá tu música", "Partí de un archivo de audio o video, o de un enlace de YouTube. Sumá la letra y dale play a tu próxima canción."],
      ["spark", "La IA hace el trabajo pesado", "Separa la voz, transcribe la letra y detecta las notas para ayudarte a sincronizar voz y música."],
      ["sliders", "Ajustá y exportá", "Editá las notas en un timeline visual, corregí la letra y generá el archivo de Ultrastar."]
    ],
    controlLabel: "IA + TU OÍDO", control: 'La IA hace<br>el trabajo pesado.<br><span class="gradient">Vos tenés<br>la última palabra.</span>',
    controlBody: "Ajustá frases, nota por nota, con un editor visual simple y preciso. Escuchá, corregí y dejá cada canción como te gusta.",
    controlLink: "Explorá el editor", songAlt: "Reproductor y letra de la canción Neon Skyline en Ultrasongs",
    how: "De tu música al próximo karaoke.", howLabel: "CÓMO FUNCIONA", howBody: "Tres pasos. Una canción lista para cantar.",
    steps: [["Elegí una canción", "Cargá un archivo de audio o video, o pegá un enlace de YouTube. Agregá la letra."], ["Procesá con IA", "Ultrasongs separa la voz, detecta las notas y alinea la letra. Todo en tu computadora."], ["Ajustá y exportá", "Revisá el resultado en el editor y exportá tu canción para Ultrastar."]],
    galleryLabel: "POR DENTRO", galleryTitle: "Todo en su lugar. Cada nota también.",
    galleryBody: "De la primera idea a tu biblioteca de canciones.",
    tabs: ["Nueva canción", "Reproductor", "Editor", "Biblioteca"],
    alts: ["Formulario para importar música y letra", "Reproductor de video con letra", "Editor visual de notas y tiempos", "Biblioteca de canciones de Ultrastar"],
    enlarge: "Ampliar captura", close: "Cerrar captura",
    requirements: "Antes de empezar", reqs: ["Windows 10/11 de 64 bits para el instalador.", "GPU NVIDIA recomendada. También funciona con CPU, con un procesamiento más lento.", "Varios GB libres para Python y los modelos de IA.", "Internet para la instalación inicial. El procesamiento se realiza localmente."],
    more: "Ver instalación y rendimiento", wip: "Proyecto en desarrollo activo. El resultado automático puede necesitar ajustes.",
    ctaLabel: "TU PRÓXIMA CANCIÓN EMPIEZA ACÁ", cta: 'Convertí tu música<br>en <span class="gradient">una experiencia.</span>', ctaBody: "Para cantar, compartir y disfrutar.",
    releases: "El botón abre las versiones disponibles en GitHub.",
    source: "Código", license: "Licencia GPLv3", support: "Apoyar el proyecto",
    local: "Tu música se procesa en tu computadora.",
    language: "Idioma",
  },
  en: {
    title: "Ultrasongs — From a song to Ultrastar",
    description: "Turn audio and lyrics into Ultrastar songs. Local AI, a visual editor, and you in control. Free and open source.",
    skip: "Skip to content", nav: ["Features", "How it works", "Download"],
    eyebrow: "CREATE. SYNC. SING.", hero: 'From a song<br>to <span class="gradient">Ultrastar.</span>',
    intro: "That song you want to sing.<br>Now you can create it, too.",
    lead: "Turn audio and lyrics into songs ready to play. With AI assistance, visual editing, and full control over the result.",
    download: "Download for Windows", github: "View on GitHub", note: "Free · Windows 10/11 · Open source",
    first: "The first launch downloads AI models (several GB).",
    preview: "THE STAGE IS YOURS", previewLabel: "Ultrasongs note editor preview",
    features: [
      ["music", "Bring your music", "Start with an audio or video file, or a YouTube link. Add the lyrics and press play on your next song."],
      ["spark", "AI does the heavy lifting", "Separates vocals, transcribes lyrics, and detects notes to help bring the voice and music into sync."],
      ["sliders", "Fine-tune and export", "Edit notes on a visual timeline, correct the lyrics, and generate your Ultrastar file."]
    ],
    controlLabel: "AI + YOUR EAR", control: 'AI does<br>the heavy lifting.<br><span class="gradient">You have<br>the final say.</span>',
    controlBody: "Fine-tune phrases, note by note, with a clear, precise visual editor. Listen, adjust, and make every song your own.",
    controlLink: "Explore the editor", songAlt: "Neon Skyline video player and lyrics in Ultrasongs",
    how: "From your music to karaoke night.", howLabel: "HOW IT WORKS", howBody: "Three steps. One song ready to sing.",
    steps: [["Pick a song", "Upload an audio or video file, or paste a YouTube link. Add the lyrics."], ["Process with AI", "Ultrasongs separates vocals, detects notes, and aligns the lyrics. All on your computer."], ["Fine-tune and export", "Review the result in the editor and export your song for Ultrastar."]],
    galleryLabel: "A LOOK INSIDE", galleryTitle: "Everything in place. Every note, too.",
    galleryBody: "From your first idea to your song library.",
    tabs: ["New song", "Player", "Editor", "Library"],
    alts: ["Form for importing music and lyrics", "Video player with song lyrics", "Visual note and timing editor", "Ultrastar song library"],
    enlarge: "Enlarge screenshot", close: "Close screenshot",
    requirements: "Before you start", reqs: ["64-bit Windows 10/11 for the installer.", "NVIDIA GPU recommended. CPU processing is supported, but slower.", "Several GB of free space for Python and AI models.", "Internet for the initial setup. Processing runs locally."],
    more: "See setup and performance", wip: "Actively in development. Automatic results may need adjustments.",
    ctaLabel: "YOUR NEXT SONG STARTS HERE", cta: 'Turn your music<br>into <span class="gradient">an experience.</span>', ctaBody: "Made to sing, share, and enjoy.",
    releases: "The button opens available releases on GitHub.",
    source: "Source", license: "GPLv3 License", support: "Support the project",
    local: "Your music is processed on your computer.",
    language: "Language",
  }
};

const icons = {
  music: '<path d="M9 18V5l12-3v13M9 8l12-3"/><ellipse cx="5.5" cy="18" rx="3.5" ry="3"/><ellipse cx="17.5" cy="15" rx="3.5" ry="3"/>',
  spark: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z"/>',
  sliders: '<path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  windows: '<path d="m3 5 8-1v7H3V5Zm10-1 8-1v8h-8V4ZM3 13h8v7l-8-1v-6Zm10 0h8v8l-8-1v-7Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  github: '<path d="M9 19c-4 1-4-2-6-2m12 5v-4a3.5 3.5 0 0 0-1-2.7c3.3-.4 6.8-1.6 6.8-7.3A5.7 5.7 0 0 0 19.3 4a5.3 5.3 0 0 0-.1-4S18 0 15 1.5a14 14 0 0 0-6 0C6 0 4.8 0 4.8 0a5.3 5.3 0 0 0-.1 4A5.7 5.7 0 0 0 3.2 8c0 5.7 3.5 6.9 6.8 7.3A3.5 3.5 0 0 0 9 18v4" transform="translate(1 1) scale(.9)"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`; }
const files = ["02-new-song.png", "03-song.png", "04-editor.png", "06-library.png"];
for (const [lang, t] of Object.entries(messages)) {
  const base = lang === "es" ? "./" : "../";
  const image = (file) => `${base}screenshots/${lang}/${file}`;
  const pageUrl = site + (lang === "en" ? "en/" : "");
  const html = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#080b14">
  <title>${t.title}</title>
  <meta name="description" content="${t.description}">
  <link rel="canonical" href="${pageUrl}">
  <link rel="alternate" hreflang="es" href="${site}">
  <link rel="alternate" hreflang="en" href="${site}en/">
  <link rel="alternate" hreflang="x-default" href="${site}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Ultrasongs">
  <meta property="og:title" content="${t.title}">
  <meta property="og:description" content="${t.description}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${site}screenshots/${lang}/04-editor.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="${base}assets/favicon.png" type="image/png">
  <link rel="stylesheet" href="${base}assets/landing.css">
  <script src="${base}assets/landing.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">${t.skip}</a>
  <header class="header wrap">
    <a class="brand" href="${base}" aria-label="Ultrasongs"><img src="${base}assets/ultrasongs.png" alt="Ultrasongs" width="1100" height="714"></a>
    <nav aria-label="${lang === "es" ? "Navegación principal" : "Main navigation"}">
      <a href="#features">${t.nav[0]}</a><a href="#how-it-works">${t.nav[1]}</a><a href="#download">${t.nav[2]}</a>
      <a class="nav-github" href="${repo}">GitHub ${icon("arrow")}</a>
    </nav>
    <div class="languages" role="group" aria-label="${t.language}"><a href="${base}" lang="es" hreflang="es" ${lang === "es" ? 'aria-current="page"' : ""}>ES</a><span>/</span><a href="${base}en/" lang="en" hreflang="en" ${lang === "en" ? 'aria-current="page"' : ""}>EN</a></div>
  </header>
  <main id="main">
    <section class="hero wrap">
      <div class="hero-copy">
        <p class="eyebrow">${t.eyebrow}</p>
        <h1>${t.hero}</h1>
        <p class="hero-intro">${t.intro}</p>
        <p class="lead">${t.lead}</p>
        <a class="button primary" href="${repo}/releases">${icon("windows")}${t.download}${icon("arrow")}</a>
        <p class="meta">${t.note}</p><p class="fine-print">${t.first}</p>
      </div>
      <div class="hero-visual">
        <div class="visual-label"><span class="live-dot"></span>${t.preview}<span class="visual-line"></span></div>
        <a class="editor-frame" href="${image("04-editor.png")}" data-lightbox aria-label="${t.enlarge}">
          <div class="window-bar" aria-hidden="true"><i></i><i></i><i></i><span>Ultrasongs</span></div>
          <img src="${image("04-editor.png")}" alt="${t.previewLabel}" width="1440" height="800" fetchpriority="high">
        </a>
        <div class="visual-caption"><span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="caption-tag">ULTRASONGS EDITOR</span></div>
      </div>
    </section>
    <section class="features wrap" id="features" aria-label="${t.nav[0]}">
      ${t.features.map(([name,title,body],i) => `<article class="feature"><div class="feature-top"><span class="feature-icon">${icon(name)}</span><span class="feature-number">0${i+1}</span></div><h2>${title}</h2><p>${body}</p></article>`).join("")}
    </section>
    <section class="control wrap">
      <a class="song-frame" href="${image("03-song.png")}" data-lightbox aria-label="${t.enlarge}"><img src="${image("03-song.png")}" alt="${t.songAlt}" width="1440" height="800" loading="lazy"></a>
      <div class="control-copy"><p class="eyebrow">${t.controlLabel}</p><h2>${t.control}</h2><p>${t.controlBody}</p><a class="text-link" href="#gallery">${t.controlLink}${icon("arrow")}</a></div>
    </section>
    <section class="how wrap" id="how-it-works">
      <p class="eyebrow">${t.howLabel}</p><h2>${t.how}</h2><p class="section-intro">${t.howBody}</p>
      <div class="steps">${t.steps.map(([title,body], i) => `<article class="step"><span class="step-number">0${i+1}</span><div><h3>${title}</h3><p>${body}</p></div></article>`).join("")}</div>
    </section>
    <section class="gallery wrap" id="gallery">
      <div class="section-heading"><div><p class="eyebrow">${t.galleryLabel}</p><h2>${t.galleryTitle}</h2></div><p>${t.galleryBody}</p></div>
      <div class="gallery-links" aria-label="${t.galleryLabel}">${t.tabs.map((name,i) => `<a href="#screen-${i}" data-gallery-tab="${i}" ${i===2?'aria-current="true"':""}>${name}</a>`).join("")}</div>
      <div class="gallery-panels">${files.map((file,i) => `<figure id="screen-${i}" data-gallery-panel="${i}"><a href="${image(file)}" data-lightbox aria-label="${t.enlarge}: ${t.tabs[i]}"><img src="${image(file)}" alt="${t.alts[i]}" width="1440" height="800" loading="lazy"></a><figcaption><span>${t.tabs[i]}</span><span>${t.enlarge} ↗</span></figcaption></figure>`).join("")}</div>
    </section>
    <section class="download wrap" id="download">
      <aside class="requirements"><h2>${icon("windows")}${t.requirements}</h2><ul>${t.reqs.map(x => `<li>${x}</li>`).join("")}</ul><a class="text-link" href="${repo}#windows-installer">${t.more}${icon("arrow")}</a><p class="development"><span class="live-dot"></span>${t.wip}</p></aside>
      <div class="download-cta"><p class="eyebrow">${t.ctaLabel}</p><h2>${t.cta}</h2><p>${t.ctaBody}</p><div class="cta-buttons"><a class="button primary" href="${repo}/releases">${icon("windows")}${t.download}</a><a class="button secondary" href="${repo}">${icon("github")}${t.github}</a></div><p class="fine-print">${t.releases}</p></div>
    </section>
    <p class="local-note wrap"><span aria-hidden="true">◇</span>${t.local}</p>
  </main>
  <footer class="footer wrap"><div><a class="footer-brand" href="${base}">ultrasongs<span>.</span></a><span class="footer-motto">${t.eyebrow}</span></div><nav aria-label="Links"><a href="${repo}">${t.source}</a><a href="${repo}/blob/master/LICENSE">${t.license}</a><a href="https://github.com/sponsors/pablopramparo">${t.support}</a></nav></footer>
  <dialog class="lightbox" aria-label="${t.enlarge}"><button type="button" class="lightbox-close" aria-label="${t.close}">×</button><img alt=""></dialog>
</body>
</html>
`;
  const target = path.join(root, "docs", lang === "en" ? "en" : "");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "index.html"), html);
}
await mkdir(path.join(root, "docs/assets"), { recursive: true });
await copyFile(path.join(root, "public/ultrasong.png"), path.join(root, "docs/assets/ultrasongs.png"));
await copyFile(path.join(root, "public/favico.png"), path.join(root, "docs/assets/favicon.png"));
await writeFile(path.join(root, "docs/.nojekyll"), "");
console.log("Landing generated: docs/index.html (ES), docs/en/index.html (EN)");

