import { Component, ElementRef, EventEmitter, Input, NgZone, Output, ViewChild } from '@angular/core';
import { clamp } from '../../util/util';
import { Config } from '../../config/config';
import { DomController } from '../../platform/dom-controller';
import { Haptic } from '../../tap-click/haptic';
import { DECELERATION_FRICTION, FRAME_MS, MAX_PICKER_SPEED, PICKER_OPT_SELECTED } from './picker-options';
import { Platform } from '../../platform/platform';
import { pointerCoord } from '../../util/dom';
import { UIEventManager } from '../../gestures/ui-event-manager';
/**
 * @hidden
 */
var PickerColumnCmp = (function () {
    function PickerColumnCmp(config, _plt, elementRef, _zone, _haptic, plt, domCtrl) {
        this.config = config;
        this._plt = _plt;
        this.elementRef = elementRef;
        this._zone = _zone;
        this._haptic = _haptic;
        this.y = 0;
        this.pos = [];
        this.startY = null;
        this.ionChange = new EventEmitter();
        this.events = new UIEventManager(plt);
        this.decelerateFunc = this.decelerate.bind(this);
        this.debouncer = domCtrl.debouncer();
    }
    PickerColumnCmp.prototype.ngAfterViewInit = function () {
        // get the scrollable element within the column
        var colEle = this.colEle.nativeElement;
        this.colHeight = colEle.clientHeight;
        // get the height of one option
        this.optHeight = (colEle.firstElementChild ? colEle.firstElementChild.clientHeight : 0);
        // Listening for pointer events
        this.events.pointerEvents({
            element: this.elementRef.nativeElement,
            pointerDown: this.pointerStart.bind(this),
            pointerMove: this.pointerMove.bind(this),
            pointerUp: this.pointerEnd.bind(this),
            capture: true,
            zone: false
        });
        this.rotateFactor = this.config.getNumber('pickerRotateFactor', 0);
        this.scaleFactor = this.config.getNumber('pickerScaleFactor', 1);
        if (this.col.mode) {
            var configMode = this.config.getModeConfig(this.col.mode);
            var getRotateFactor = configMode.pickerRotateFactor;
            var getScaleFactor = configMode.pickerScaleFactor;
            if (getRotateFactor !== undefined) {
                this.rotateFactor = this.config.parseNumber(getRotateFactor, this.rotateFactor);
            }
            if (getScaleFactor !== undefined) {
                this.scaleFactor = this.config.parseNumber(getScaleFactor, this.scaleFactor);
            }
        }
    };
    PickerColumnCmp.prototype.ngOnDestroy = function () {
        this._plt.cancelRaf(this.rafId);
        this.events.destroy();
    };
    PickerColumnCmp.prototype.pointerStart = function (ev) {
        (void 0) /* console.debug */;
        this._haptic.gestureSelectionStart();
        // We have to prevent default in order to block scrolling under the picker
        // but we DO NOT have to stop propagation, since we still want
        // some "click" events to capture
        ev.preventDefault();
        // cancel any previous raf's that haven't fired yet
        this._plt.cancelRaf(this.rafId);
        // remember where the pointer started from`
        this.startY = pointerCoord(ev).y;
        // reset everything
        this.velocity = 0;
        this.pos.length = 0;
        this.pos.push(this.startY, Date.now());
        var options = this.col.options;
        var minY = (options.length - 1);
        var maxY = 0;
        for (var i = 0; i < options.length; i++) {
            if (!options[i].disabled) {
                minY = Math.min(minY, i);
                maxY = Math.max(maxY, i);
            }
        }
        this.minY = (minY * this.optHeight * -1);
        this.maxY = (maxY * this.optHeight * -1);
        return true;
    };
    PickerColumnCmp.prototype.pointerMove = function (ev) {
        var _this = this;
        ev.preventDefault();
        ev.stopPropagation();
        var currentY = pointerCoord(ev).y;
        this.pos.push(currentY, Date.now());
        this.debouncer.write(function () {
            if (_this.startY === null) {
                return;
            }
            // update the scroll position relative to pointer start position
            var y = _this.y + (currentY - _this.startY);
            if (y > _this.minY) {
                // scrolling up higher than scroll area
                y = Math.pow(y, 0.8);
                _this.bounceFrom = y;
            }
            else if (y < _this.maxY) {
                // scrolling down below scroll area
                y += Math.pow(_this.maxY - y, 0.9);
                _this.bounceFrom = y;
            }
            else {
                _this.bounceFrom = 0;
            }
            _this.update(y, 0, false, false);
            var currentIndex = Math.max(Math.abs(Math.round(y / _this.optHeight)), 0);
            if (currentIndex !== _this.lastTempIndex) {
                // Trigger a haptic event for physical feedback that the index has changed
                _this._haptic.gestureSelectionChanged();
                _this.lastTempIndex = currentIndex;
            }
        });
    };
    PickerColumnCmp.prototype.pointerEnd = function (ev) {
        ev.preventDefault();
        this.debouncer.cancel();
        if (this.startY === null) {
            return;
        }
        (void 0) /* console.debug */;
        this.velocity = 0;
        if (this.bounceFrom > 0) {
            // bounce back up
            this.update(this.minY, 100, true, true);
            return;
        }
        else if (this.bounceFrom < 0) {
            // bounce back down
            this.update(this.maxY, 100, true, true);
            return;
        }
        var endY = pointerCoord(ev).y;
        this.pos.push(endY, Date.now());
        var endPos = (this.pos.length - 1);
        var startPos = endPos;
        var timeRange = (Date.now() - 100);
        // move pointer to position measured 100ms ago
        for (var i = endPos; i > 0 && this.pos[i] > timeRange; i -= 2) {
            startPos = i;
        }
        if (startPos !== endPos) {
            // compute relative movement between these two points
            var timeOffset = (this.pos[endPos] - this.pos[startPos]);
            var movedTop = (this.pos[startPos - 1] - this.pos[endPos - 1]);
            // based on XXms compute the movement to apply for each render step
            var velocity = ((movedTop / timeOffset) * FRAME_MS);
            this.velocity = clamp(-MAX_PICKER_SPEED, velocity, MAX_PICKER_SPEED);
        }
        if (Math.abs(endY - this.startY) > 3) {
            var y = this.y + (endY - this.startY);
            this.update(y, 0, true, true);
        }
        this.startY = null;
        this.decelerate();
    };
    PickerColumnCmp.prototype.decelerate = function () {
        var y = 0;
        if (isNaN(this.y) || !this.optHeight) {
            // fallback in case numbers get outta wack
            this.update(y, 0, true, true);
            this._haptic.gestureSelectionEnd();
        }
        else if (Math.abs(this.velocity) > 0) {
            // still decelerating
            this.velocity *= DECELERATION_FRICTION;
            // do not let it go slower than a velocity of 1
            this.velocity = (this.velocity > 0)
                ? Math.max(this.velocity, 1)
                : Math.min(this.velocity, -1);
            y = Math.round(this.y - this.velocity);
            if (y > this.minY) {
                // whoops, it's trying to scroll up farther than the options we have!
                y = this.minY;
                this.velocity = 0;
            }
            else if (y < this.maxY) {
                // gahh, it's trying to scroll down farther than we can!
                y = this.maxY;
                this.velocity = 0;
            }
            var notLockedIn = (y % this.optHeight !== 0 || Math.abs(this.velocity) > 1);
            this.update(y, 0, true, !notLockedIn);
            if (notLockedIn) {
                // isn't locked in yet, keep decelerating until it is
                this.rafId = this._plt.raf(this.decelerateFunc);
            }
        }
        else if (this.y % this.optHeight !== 0) {
            // needs to still get locked into a position so options line up
            var currentPos = Math.abs(this.y % this.optHeight);
            // create a velocity in the direction it needs to scroll
            this.velocity = (currentPos > (this.optHeight / 2) ? 1 : -1);
            this._haptic.gestureSelectionEnd();
            this.decelerate();
        }
        var currentIndex = Math.max(Math.abs(Math.round(y / this.optHeight)), 0);
        if (currentIndex !== this.lastTempIndex) {
            // Trigger a haptic event for physical feedback that the index has changed
            this._haptic.gestureSelectionChanged();
        }
        this.lastTempIndex = currentIndex;
    };
    PickerColumnCmp.prototype.optClick = function (ev, index) {
        if (!this.velocity) {
            ev.preventDefault();
            ev.stopPropagation();
            this.setSelected(index, 150);
        }
    };
    PickerColumnCmp.prototype.setSelected = function (selectedIndex, duration) {
        // if there is a selected index, then figure out it's y position
        // if there isn't a selected index, then just use the top y position
        var y = (selectedIndex > -1) ? ((selectedIndex * this.optHeight) * -1) : 0;
        this._plt.cancelRaf(this.rafId);
        this.velocity = 0;
        // so what y position we're at
        this.update(y, duration, true, true);
    };
    PickerColumnCmp.prototype.update = function (y, duration, saveY, emitChange) {
        // ensure we've got a good round number :)
        y = Math.round(y);
        var i;
        var button;
        var opt;
        var optOffset;
        var visible;
        var translateX;
        var translateY;
        var translateZ;
        var rotateX;
        var transform;
        var selected;
        var parent = this.colEle.nativeElement;
        var children = parent.children;
        var length = children.length;
        var selectedIndex = this.col.selectedIndex = Math.min(Math.max(Math.round(-y / this.optHeight), 0), length - 1);
        var durationStr = (duration === 0) ? null : duration + 'ms';
        var scaleStr = "scale(" + this.scaleFactor + ")";
        for (i = 0; i < length; i++) {
            button = children[i];
            opt = this.col.options[i];
            optOffset = (i * this.optHeight) + y;
            visible = true;
            transform = '';
            if (this.rotateFactor !== 0) {
                rotateX = optOffset * this.rotateFactor;
                if (Math.abs(rotateX) > 90) {
                    visible = false;
                }
                else {
                    translateX = 0;
                    translateY = 0;
                    translateZ = 90;
                    transform = "rotateX(" + rotateX + "deg) ";
                }
            }
            else {
                translateX = 0;
                translateZ = 0;
                translateY = optOffset;
                if (Math.abs(translateY) > 170) {
                    visible = false;
                }
            }
            selected = selectedIndex === i;
            if (visible) {
                transform += "translate3d(0px," + translateY + "px," + translateZ + "px) ";
                if (this.scaleFactor !== 1 && !selected) {
                    transform += scaleStr;
                }
            }
            else {
                transform = 'translate3d(-9999px,0px,0px)';
            }
            // Update transition duration
            if (duration !== opt._dur) {
                opt._dur = duration;
                button.style[this._plt.Css.transitionDuration] = durationStr;
            }
            // Update transform
            if (transform !== opt._trans) {
                opt._trans = transform;
                button.style[this._plt.Css.transform] = transform;
            }
            // Update selected item
            if (selected !== opt._selected) {
                opt._selected = selected;
                if (selected) {
                    button.classList.add(PICKER_OPT_SELECTED);
                }
                else {
                    button.classList.remove(PICKER_OPT_SELECTED);
                }
            }
        }
        this.col.prevSelected = selectedIndex;
        if (saveY) {
            this.y = y;
        }
        if (emitChange) {
            if (this.lastIndex !== this.col.selectedIndex) {
                // have not set a last index yet or new selected
                // index has changed from the last index
                // update the lastIndex and emit that it has changed
                this.lastIndex = this.col.selectedIndex;
                var ionChange = this.ionChange;
                if (ionChange.observers.length > 0) {
                    this._zone.run(ionChange.emit.bind(ionChange, this.col.options[this.col.selectedIndex]));
                }
            }
        }
    };
    PickerColumnCmp.prototype.refresh = function () {
        var min = this.col.options.length - 1;
        var max = 0;
        var options = this.col.options;
        for (var i = 0; i < options.length; i++) {
            if (!options[i].disabled) {
                min = Math.min(min, i);
                max = Math.max(max, i);
            }
        }
        var selectedIndex = clamp(min, this.col.selectedIndex, max);
        if (this.col.prevSelected !== selectedIndex) {
            var y = (selectedIndex * this.optHeight) * -1;
            this._plt.cancelRaf(this.rafId);
            this.velocity = 0;
            this.update(y, 150, true, false);
        }
    };
    PickerColumnCmp.decorators = [
        { type: Component, args: [{
                    selector: '.picker-col',
                    template: '<div *ngIf="col.prefix" class="picker-prefix" [style.width]="col.prefixWidth">{{col.prefix}}</div>' +
                        '<div class="picker-opts" #colEle [style.max-width]="col.optionsWidth">' +
                        '<button *ngFor="let o of col.options; let i=index"' +
                        '[class.picker-opt-disabled]="o.disabled" ' +
                        'class="picker-opt" disable-activated (click)="optClick($event, i)">' +
                        '{{o.text}}' +
                        '</button>' +
                        '</div>' +
                        '<div *ngIf="col.suffix" class="picker-suffix" [style.width]="col.suffixWidth">{{col.suffix}}</div>',
                    host: {
                        '[style.max-width]': 'col.columnWidth',
                        '[class.picker-opts-left]': 'col.align=="left"',
                        '[class.picker-opts-right]': 'col.align=="right"',
                    }
                },] },
    ];
    /** @nocollapse */
    PickerColumnCmp.ctorParameters = function () { return [
        { type: Config, },
        { type: Platform, },
        { type: ElementRef, },
        { type: NgZone, },
        { type: Haptic, },
        { type: Platform, },
        { type: DomController, },
    ]; };
    PickerColumnCmp.propDecorators = {
        'colEle': [{ type: ViewChild, args: ['colEle',] },],
        'col': [{ type: Input },],
        'ionChange': [{ type: Output },],
    };
    return PickerColumnCmp;
}());
export { PickerColumnCmp };
//# sourceMappingURL=picker-column.js.map