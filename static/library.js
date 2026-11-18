const divider = document.querySelector(".sidebar-divider");
const narrowLayout = matchMedia("(max-width: 760px)");
let sidebarWidth = 228;
let dragOffset = 0;

function resizeSidebar(width) {
  if (narrowLayout.matches) return;
  const max = Math.floor(document.documentElement.clientWidth * 0.30);
  sidebarWidth = Math.min(max, Math.max(188, Math.round(width)));
  document.body.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  divider.setAttribute("aria-valuemin", "188");
  divider.setAttribute("aria-valuemax", String(max));
  divider.setAttribute("aria-valuenow", String(sidebarWidth));
}

divider.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragOffset = sidebarWidth - event.clientX;
  divider.setPointerCapture(event.pointerId);
});
divider.addEventListener("pointermove", (event) => {
  if (divider.hasPointerCapture(event.pointerId)) resizeSidebar(event.clientX + dragOffset);
});
divider.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  resizeSidebar(sidebarWidth + (event.key === "ArrowLeft" ? -12 : 12));
});

new ResizeObserver(() => resizeSidebar(sidebarWidth)).observe(document.documentElement);
narrowLayout.addEventListener("change", () => resizeSidebar(sidebarWidth));
resizeSidebar(sidebarWidth);
