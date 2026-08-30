(function () {
  "use strict";

  /* Names follow the canonical v03 Site 0 architecture contract. The selector
     stays deliberately light: the production GLB remains a separate master. */
  var LEVELS = {
    L4: {
      title: "Island Superstructure / Flight Control",
      short: "ISLAND / FLIGHT CONTROL",
      image: "assets/hitman/facility-stack.webp",
      position: "50% 4%"
    },
    L3: {
      title: "Flight / Landing-Launch Deck",
      short: "FLIGHT / LANDING-LAUNCH DECK",
      image: "assets/hitman/level-l3.webp",
      position: "50% 50%"
    },
    L2: {
      title: "Business Administration + Aviation Support",
      short: "BUSINESS + AVIATION SUPPORT",
      image: "assets/hitman/level-l2.webp",
      position: "50% 50%"
    },
    L1: {
      title: "Ground Defense / Enforcement / Coexistence",
      short: "GROUND DEFENSE / ENFORCEMENT",
      image: "assets/hitman/facility-front.webp",
      position: "50% 54%"
    },
    B1: {
      title: "Open Technology Research Vault",
      short: "OPEN TECHNOLOGY RESEARCH VAULT",
      image: "assets/hitman/level-b1.webp",
      position: "50% 50%"
    },
    B2: {
      title: "Industrial Production & Advanced Fabrication",
      short: "INDUSTRIAL PRODUCTION / FABRICATION",
      image: "assets/hitman/facility-stack.webp",
      position: "50% 62%"
    },
    B3: {
      title: "Prime Command & Sustainment + Heavy Deployment",
      short: "PRIME COMMAND / SUSTAINMENT",
      image: "assets/hitman/facility-stack.webp",
      position: "50% 72%"
    },
    B4: {
      title: "Deep Transit / Interfacility Logistics",
      short: "DEEP TRANSIT / INTERFACILITY LOGISTICS",
      image: "assets/hitman/facility-stack.webp",
      position: "50% 84%"
    },
    B5: {
      title: "Global Coordination / Resilience Node",
      short: "GLOBAL COORDINATION / RESILIENCE",
      image: "assets/hitman/facility-stack.webp",
      position: "50% 96%"
    }
  };

  var ORDER = ["L4", "L3", "L2", "L1", "B1", "B2", "B3", "B4", "B5"];
  var root = document.getElementById("facility");
  if (!root) return;

  var buttons = [].slice.call(document.querySelectorAll(".hf-level"));
  var focus = document.querySelector(".hf-focus");
  var img = document.getElementById("hf-plan-img");
  var selectedCode = document.getElementById("hf-selected-code");
  var selectedName = document.getElementById("hf-selected-name");
  var enterLink = document.getElementById("hf-enter");
  var enterCode = document.getElementById("hf-enter-code");
  if (!focus || !img || !selectedCode || !selectedName) return;

  function activate(level, moveFocus) {
    var data = LEVELS[level];
    if (!data) return;

    root.dataset.activeLevel = level;
    selectedCode.textContent = level;
    selectedName.textContent = data.short;

    // The selector's levels are the same programme the playable model was
    // reprogrammed to, so the chosen one can be handed straight to the game.
    if (enterLink) {
      enterLink.href = "site0/?level=" + encodeURIComponent(level);
      if (enterCode) enterCode.textContent = level;
    }
    focus.setAttribute("aria-label", level + " · " + data.title + " selected");

    buttons.forEach(function (button) {
      var active = button.dataset.level === level;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active && moveFocus) button.focus({ preventScroll: true });
    });

    img.classList.add("is-swapping");
    var next = new Image();
    next.onload = function () {
      img.src = data.image;
      img.alt = level + " · " + data.title + " preview";
      img.style.objectPosition = data.position;
      requestAnimationFrame(function () {
        img.classList.remove("is-swapping");
      });
    };
    next.onerror = function () {
      img.classList.remove("is-swapping");
    };
    next.src = data.image;

    try { sessionStorage.setItem("hitman_facility_level", level); } catch (e) {}
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      activate(button.dataset.level, false);
    });

    button.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      var current = ORDER.indexOf(button.dataset.level);
      var delta = event.key === "ArrowUp" ? -1 : 1;
      var nextIndex = Math.max(0, Math.min(ORDER.length - 1, current + delta));
      activate(ORDER[nextIndex], true);
    });
  });

  /* This room is a single-screen game interface. Prevent wheel/touch scroll
     from turning the nine-level selector into a normal webpage. */
  document.addEventListener("touchmove", function (event) {
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  document.addEventListener("wheel", function (event) {
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  var initial = "L1";
  try {
    var saved = sessionStorage.getItem("hitman_facility_level");
    if (saved && LEVELS[saved]) initial = saved;
  } catch (e) {}

  activate(initial, false);
})();
