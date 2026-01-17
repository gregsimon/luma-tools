/**
 * LumaTooltips
 * A simple, non-interfering tooltip system for Luma Tools.
 * 
 * Features:
 * - Loads localization data from JSON
 * - Uses delegation to avoid attaching thousands of listeners
 * - Rendered overlay uses 'pointer-events: none' to completely avoid
 *   interfering with canvas mouse operations.
 */

const LumaTooltips = {
  data: {},
  currentLang: 'en',
  initialized: false,
  tooltipElement: null,
  hoverDelay: 1000, // Adjustable delay in ms
  timeoutId: null,

  init: function (lang = 'en') {
    if (this.initialized) return;
    this.currentLang = lang;

    // Create the tooltip DOM element
    this.createTooltipElement();

    // Load data
    this.loadData(lang).then(() => {
      // Attach event listeners to body for delegation
      this.attachListeners();
      this.initialized = true;
      console.log('LumaTooltips initialized');
    }).catch(err => {
      console.error('Failed to initialize LumaTooltips:', err);
    });
  },

  createTooltipElement: function () {
    const div = document.createElement('div');
    div.id = 'global-tooltip';
    div.style.display = 'none';
    document.body.appendChild(div);
    this.tooltipElement = div;
  },

  loadData: function (lang) {
    const path = `data/tooltips.${lang}.json`;
    return fetch(path)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
      })
      .then(json => {
        this.data = json;
      });
  },

  attachListeners: function () {
    document.body.addEventListener('mouseover', (e) => {
      // Don't show tooltip if any mouse button is down (dragging)
      if (e.buttons !== 0) return;

      // Find closest element with data-tooltip
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        const key = target.getAttribute('data-tooltip');
        // Clear any existing timeout to avoid overlaps
        if (this.timeoutId) clearTimeout(this.timeoutId);

        // internal closure to capture the event
        this.timeoutId = setTimeout(() => {
          this.show(key, target, e);
        }, this.hoverDelay);
      }
    });

    document.body.addEventListener('mouseout', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        if (this.timeoutId) clearTimeout(this.timeoutId);
        this.hide();
      }
    });

    // Hide tooltip immediately on any click
    document.body.addEventListener('mousedown', () => {
      if (this.timeoutId) clearTimeout(this.timeoutId);
      this.hide();
    });

    // Also track mouse move to update position if needed
    // Optional: we could just position it once on enter, or track it.
    // Tracking it alongside the mouse is usually better for "hover" feel.
    document.body.addEventListener('mousemove', (e) => {
      if (this.tooltipElement.style.display === 'block') {
        this.updatePosition(e);
      }
    });
  },

  show: function (key, targetElement, mouseEvent) {
    const text = this.data[key];
    if (!text) return; // Key not found

    const el = this.tooltipElement;
    el.textContent = text;
    el.style.display = 'block';

    // Position initially
    this.updatePosition(mouseEvent);
  },

  hide: function () {
    if (this.tooltipElement) {
      this.tooltipElement.style.display = 'none';
    }
  },

  updatePosition: function (e) {
    const el = this.tooltipElement;
    const offset = 15; // px away from cursor

    // Keep it within viewport bounds (simple check)
    let left = e.pageX + offset;
    let top = e.pageY + offset;

    // If going off right edge
    if (left + el.offsetWidth > window.innerWidth) {
      left = e.pageX - el.offsetWidth - offset;
    }

    // If going off bottom edge
    if (top + el.offsetHeight > window.innerHeight) {
      top = e.pageY - el.offsetHeight - offset;
    }

    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
};

// Expose globally
window.LumaTooltips = LumaTooltips;
