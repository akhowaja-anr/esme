export function closeModal() {
  const modalOverlay = document.getElementById("modalOverlay");
  const modalBody = document.getElementById("modalBody");
  const modalFooter = document.getElementById("modalFooter");
  const modalTitle = document.getElementById("modalTitle");

  modalOverlay.style.display = "none";
  modalBody.innerHTML = "";
  modalFooter.innerHTML = "";
  modalTitle.textContent = "";
}

export function showModal(options) {
  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalFooter = document.getElementById("modalFooter");

  modalTitle.textContent = options.title || "";
  modalBody.innerHTML = options.bodyHtml || "";
  modalFooter.innerHTML = "";

  if (options.secondaryText) {
    const secondaryBtn = document.createElement("button");
    secondaryBtn.className = "modal-btn modal-btn-secondary";
    secondaryBtn.textContent = options.secondaryText;
    secondaryBtn.addEventListener("click", () => {
      if (typeof options.onSecondary === "function") options.onSecondary();
      closeModal();
    });
    modalFooter.appendChild(secondaryBtn);
  }

  if (options.primaryText) {
    const primaryBtn = document.createElement("button");
    let cls = "modal-btn modal-btn-primary";
    if (options.primaryType === "danger") cls = "modal-btn modal-btn-danger";
    primaryBtn.className = cls;
    primaryBtn.textContent = options.primaryText;
    primaryBtn.addEventListener("click", () => {
      if (typeof options.onPrimary === "function") options.onPrimary();
    });
    modalFooter.appendChild(primaryBtn);
  }

  modalOverlay.style.display = "flex";
}

export function wireModalCloseHandlers() {
  const modalOverlay = document.getElementById("modalOverlay");
  const modalClose = document.getElementById("modalClose");

  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
}
