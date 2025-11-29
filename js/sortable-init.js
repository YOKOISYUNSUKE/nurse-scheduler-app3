// js/sortable-init.js

// 直近でドラッグされたカードを覚えておく
// （ドラッグ完了直後の「誤クリック遷移」を 1 回だけ防ぐ）
let lastDraggedItem = null;

document.addEventListener("DOMContentLoaded", () => {
  // SortableJS が読み込まれていなければ何もしない
  if (typeof Sortable === "undefined") {
    console.warn("SortableJS is not loaded.");
    return;
  }

  // 並べ替え対象のコンテナを全て取得
  const containers = document.querySelectorAll("[data-sortable-id]");

  containers.forEach((container) => {
    const sortableId = container.getAttribute("data-sortable-id");
    if (!sortableId) return;

    // ページパスと組み合わせてキーを作る（ページごとに別々の順番を保存）
    const storageKey = `medcalc-order:${location.pathname}#${sortableId}`;

    // SortableJS を初期化
    new Sortable(container, {
      animation: 150,
      dataIdAttr: "data-id",
      draggable: ".dept-card, .score-card",
      handle: ".dept-card, .score-card",
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",

      // ドラッグ開始時にどのカードを掴んだか記録
      onStart(evt) {
        lastDraggedItem = evt.item;
      },

      // 並び順の保存
      store: {
        get() {
          try {
            const order = localStorage.getItem(storageKey);
            if (!order) return [];
            return order.split("|").filter(Boolean);
          } catch (e) {
            console.warn("Failed to get sort order:", e);
            return [];
          }
        },
        set(sortable) {
          try {
            const order = sortable.toArray(); // data-id の配列
            localStorage.setItem(storageKey, order.join("|"));
          } catch (e) {
            console.warn("Failed to save sort order:", e);
          }
        },
      },
    });
  });

  // --- ここから：ドラッグ後 1 回だけクリックをキャンセルする処理 ---
  document.addEventListener(
    "click",
    (e) => {
      // 直近でドラッグされたカードがなければ何もしない
      if (!lastDraggedItem) return;

      const card = e.target.closest(".dept-card, .score-card");

      // どのカードもクリックされていなければ、フラグだけ消して終了
      if (!card) {
        lastDraggedItem = null;
        return;
      }

      // 「直前にドラッグしたカード」に対する最初のクリックならキャンセル
      if (card === lastDraggedItem) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }

      // 1 回処理したら必ずフラグを消す
      lastDraggedItem = null;
    },
    true // キャプチャフェーズで実行 -> main.js や inline onclick より先に動く
  );
  // --- ここまで ---
});
