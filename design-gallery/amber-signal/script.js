/**
 * VST Style Forge - Interaction Logic
 */

class Knob {
  constructor(element) {
    this.element = element;
    this.value = 0.5; 
    this.isDragging = false;
    this.startY = 0;
    this.startVal = 0;
    
    // Find SVG parts
    this.path = element.querySelector('.value-arc');
    
    // Bind events
    element.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
    
    this.update();
  }
  
  onMouseDown(e) {
    this.isDragging = true;
    this.startY = e.clientY;
    this.startVal = this.value;
    document.body.style.cursor = 'ns-resize';
  }
  
  onMouseMove(e) {
    if (!this.isDragging) return;
    const delta = this.startY - e.clientY;
    const sensitivity = 0.005;
    this.value = Math.min(Math.max(this.startVal + delta * sensitivity, 0), 1);
    this.update();
  }
  
  onMouseUp() {
    this.isDragging = false;
    document.body.style.cursor = 'default';
  }
  
  update() {
    // Assuming 64px box, r=28
    const circumference = 2 * Math.PI * 28;
    const arcLength = circumference * 0.75;
    const dashOffset = arcLength - (this.value * arcLength);
    
    if (this.path) {
        this.path.style.strokeDasharray = `${arcLength} ${circumference}`;
        this.path.style.strokeDashoffset = dashOffset;
    }
  }
}

class Fader {
  constructor(element) {
    this.element = element;
    this.value = 0.5;
    this.isDragging = false;
    this.startY = 0;
    this.startVal = 0;
    
    this.handle = element.querySelector('.fader-handle');
    this.fill = element.querySelector('.fader-fill');
    
    if(this.handle) {
       this.handle.addEventListener('mousedown', this.onMouseDown.bind(this));
    }
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
    
    this.update();
  }

  onMouseDown(e) {
    e.stopPropagation(); // prevent parent clicks
    this.isDragging = true;
    this.startY = e.clientY;
    this.startVal = this.value;
    document.body.style.cursor = 'ns-resize';
  }

  onMouseMove(e) {
    if (!this.isDragging) return;
    const delta = this.startY - e.clientY;
    const pixelRange = this.element.clientHeight - 40; // Approx handle height
    const valDelta = delta / pixelRange;
    
    this.value = Math.min(Math.max(this.startVal + valDelta, 0), 1);
    this.update();
  }

  onMouseUp() {
    this.isDragging = false;
    document.body.style.cursor = 'default';
  }

  update() {
    if (this.handle) {
        this.handle.style.bottom = `calc(${this.value * 100}% - 20px)`;
    }
    if (this.fill) {
        this.fill.style.height = `${this.value * 100}%`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.knob-container').forEach(el => new Knob(el));
    document.querySelectorAll('.fader-container').forEach(el => new Fader(el));
});
