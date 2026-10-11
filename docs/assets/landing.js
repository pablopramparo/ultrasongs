(() => {
  const links = [...document.querySelectorAll("[data-gallery-tab]")];
  const panels = [...document.querySelectorAll("[data-gallery-panel]")];
  function select(index) {
    links.forEach(link => {
      if (link.dataset.galleryTab === index) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    panels.forEach(panel => { panel.hidden = panel.dataset.galleryPanel !== index; });
  }
  function fromHash() {
    const match = /^#screen-([0-3])$/.exec(location.hash);
    if (match) select(match[1]);
  }
  select(/^#screen-([0-3])$/.exec(location.hash)?.[1] ?? "2");
  window.addEventListener("hashchange", fromHash);
  links.forEach(link => link.addEventListener("click", () => select(link.dataset.galleryTab)));
  // Keep the current section when changing language.
  document.querySelectorAll(".languages a").forEach(link => {
    link.addEventListener("click", () => {
      link.hash = location.hash;
    });
  });
  const dialog = document.querySelector(".lightbox");
  const largeImage = dialog.querySelector("img");
  if (typeof dialog.showModal === "function") {
    document.querySelectorAll("[data-lightbox]").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        largeImage.src = link.href;
        largeImage.alt = link.querySelector("img").alt;
        dialog.showModal();
        document.documentElement.classList.add("modal-open");
      });
    });
    dialog.querySelector("button").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.documentElement.classList.remove("modal-open");
      largeImage.removeAttribute("src");
    });
  }
})();

