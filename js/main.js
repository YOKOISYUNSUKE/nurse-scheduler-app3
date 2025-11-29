// main.js

// 診療科ボタンのクリック処理
document.addEventListener("DOMContentLoaded", () => {
  const cards = document.querySelectorAll(".dept-card");

  // 診療科と遷移先ページの対応表
const DEPT_PAGE_MAP = {
  emergency: "emergency/emergency.index.html",
  rheumatology: "rheumatology/rheumatology.index.html",
  cardiology: "cardiology/cardiology.index.html",
  respiratory: "respiratory/respiratory.index.html",
  nephrology: "nephrology/nephrology.index.html",
  hematology: "hematology/hematology.index.html",
  gastroenterology: "gastroenterology/gastroenterology.index.html",
  neurology: "neurology/neurology.index.html",
  infectious: "infectious/infectious.index.html",
  endocrine: "endocrine/endocrine.index.html", 
};


  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const dept = card.dataset.dept; // "emergency", "rheumatology" など
      const nameElem = card.querySelector(".dept-name");
      const deptLabel = nameElem ? nameElem.textContent : dept;

      const target = DEPT_PAGE_MAP[dept];

      if (target) {
        // 対応ページが定義されていれば遷移
        window.location.href = target;
      } else {
        // 念のためのフォールバック
        alert(`「${deptLabel}」のページはまだ準備中です（dept=${dept}）`);
      }
    });
  });
});
