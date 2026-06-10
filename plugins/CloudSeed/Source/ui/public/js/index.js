import { getSliderState, getToggleState } from "./juce/index.js";
import { makeKnob, updateKnob } from "./knob.js";
import { fmt } from "./format.js";

function initUI() {
    var cells = document.querySelectorAll(".pc");
    for (var i = 0; i < cells.length; i++) {
        (function(cell) {
            var pid = cell.getAttribute("data-p");
            var type = cell.getAttribute("data-t");
            var valEl = cell.querySelector(".pc-val");

            if (type === "s") {
                var knobEl = cell.querySelector(".knob");
                var k = makeKnob(knobEl);
                var state = getSliderState(pid);

                var refresh = function() {
                    var n = state.getNormalisedValue();
                    updateKnob(k, n);
                    valEl.textContent = fmt(pid, n);
                };
                state.valueChangedEvent.addListener(refresh);
                state.propertiesChangedEvent.addListener(refresh);
                refresh();

                var dragging = false, startY = 0, startVal = 0;
                knobEl.addEventListener("mousedown", function(e) {
                    dragging = true;
                    startY = e.clientY;
                    startVal = state.getNormalisedValue();
                    state.sliderDragStarted();
                    e.preventDefault();
                });
                window.addEventListener("mousemove", function(e) {
                    if (!dragging) return;
                    var sens = e.shiftKey ? 0.001 : 0.005;
                    var nv = Math.max(0, Math.min(1, startVal + (startY - e.clientY) * sens));
                    state.setNormalisedValue(nv);
                });
                window.addEventListener("mouseup", function() {
                    if (dragging) { dragging = false; state.sliderDragEnded(); }
                });
                knobEl.addEventListener("dblclick", function() {
                    state.sliderDragStarted();
                    state.setNormalisedValue(0);
                    state.sliderDragEnded();
                });

            } else if (type === "b") {
                var togEl = cell.querySelector(".tog");
                var tstate = getToggleState(pid);

                var refreshT = function() {
                    var on = tstate.getValue();
                    if (on) togEl.classList.add("on"); else togEl.classList.remove("on");
                    if (pid === "late_mode") valEl.textContent = on ? "POST" : "PRE";
                    else valEl.textContent = on ? "ON" : "OFF";
                };
                tstate.valueChangedEvent.addListener(refreshT);
                refreshT();

                togEl.addEventListener("click", function() {
                    tstate.setValue(!tstate.getValue());
                });
            }
        })(cells[i]);
    }
}

initUI();
