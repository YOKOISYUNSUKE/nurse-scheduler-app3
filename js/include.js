// js/include.js
document.addEventListener("DOMContentLoaded", () => {
  const includeTargets = document.querySelectorAll("[data-include]");

  includeTargets.forEach((el) => {
    const path = el.getAttribute("data-include");
    if (!path) return;

    fetch(path)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load: ${path}`);
        }
        return res.text();
      })
      .then((html) => {
        el.innerHTML = html;

        // header が読み込まれたあとにサブタイトルを設定
        if (path.includes("header.html")) {
          const subtitleElem = el.querySelector(".app-subtitle");
          if (subtitleElem) {
            const subtitle = document.body.dataset.subtitle;
            subtitleElem.textContent =
              subtitle || "診療科を選んでスコア計算へ進んでください";
          }
        }
      })
      .catch((err) => {
        console.error(err);
      });
  });
});
