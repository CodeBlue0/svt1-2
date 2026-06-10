(function () {
  const requested = (new URLSearchParams(window.location.search).get("dataset") || "").toLowerCase();
  if (requested === "maze") {
    window.location.replace("maze.html");
    return;
  }

  function renderSwitcher() {
    document.querySelectorAll("[data-dataset-switcher]").forEach((node) => {
      node.textContent = "";
      [
        ["svt", "SVT", "index.html"],
        ["rsvp", "RSVP", "maze.html"],
      ].forEach(([key, label, href]) => {
        const link = document.createElement("a");
        link.className = `dataset-option${key === "svt" ? " active" : ""}`;
        link.href = href;
        link.textContent = label;
        node.append(link);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderSwitcher);
  } else {
    renderSwitcher();
  }
})();
