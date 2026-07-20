(function () {
	var IMG_SRC = 'floating-head.png';
	var INITIAL_SIZE = 100;
	var MAX_SIZE = INITIAL_SIZE; // merging never grows heads past the original size
	var MIN_SIZE = 6; // heads smaller than this no longer split
	var BASE_SPEED = 80; // px per second
	var ROTATION_SPEED = 60; // deg per second
	var MERGE_COOLDOWN = 0.6; // seconds before a freshly spawned head can merge (avoids re-merging siblings instantly)
	var HIT_TOLERANCE = 20; // extra px of forgiveness beyond a head's own radius when aiming

	var BRICK_UNIT = 40; // brick length along the wall it's part of
	var BRICK_THICKNESS = 16; // brick thickness (the wall's depth)
	var FRAME_PADDING = 36; // gap between the content and the inner edge of the brick frame
	var BRICK_COLORS = { top: '#e63946', right: '#f4a300', bottom: '#ffd60a', left: '#06d6a0' };

	var RETURN_SPEED = 350; // px per second a dislodged icon flies home when shot

	var heads = [];
	var bricks = [];
	var dislodgeables = [];
	var frameInner = null; // hollow area walled off by the brick frame - kept clear of head spawns
	var lastTime = null;
	var audioCtx = null;

	function getAudioContext() {
		var Ctx = window.AudioContext || window.webkitAudioContext;
		if (!Ctx) return null;
		if (!audioCtx) audioCtx = new Ctx();
		return audioCtx;
	}

	function playNoiseBurst(duration, filterType, filterFreq, filterQ, volume, envelopePower) {
		var ctx = getAudioContext();
		if (!ctx) return;
		try {
			var bufferSize = Math.floor(ctx.sampleRate * duration);
			var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
			var data = buffer.getChannelData(0);
			for (var i = 0; i < bufferSize; i++) {
				data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, envelopePower);
			}

			var noise = ctx.createBufferSource();
			noise.buffer = buffer;

			var filter = ctx.createBiquadFilter();
			filter.type = filterType;
			filter.frequency.value = filterFreq;
			if (filterQ !== undefined) filter.Q.value = filterQ;

			var gain = ctx.createGain();
			gain.gain.setValueAtTime(volume, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

			noise.connect(filter);
			filter.connect(gain);
			gain.connect(ctx.destination);
			noise.start();
			noise.stop(ctx.currentTime + duration);
		} catch (e) {
			// Audio unavailable/blocked - the visual effect still plays.
		}
	}

	function randomVelocity(speed) {
		var angle = Math.random() * Math.PI * 2;
		return {
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed
		};
	}

	// --- Shared AABB helpers, used for every moving-object-vs-moving-object
	// pairing (heads, dislodgeables) so everything can bounce off everything,
	// not just off the static bricks. ---------------------------------------

	function objW(o) { return o.size !== undefined ? o.size : o.width; }
	function objH(o) { return o.size !== undefined ? o.size : o.height; }

	function aabbOverlap(a, b) {
		var overlapX = Math.min(a.x + objW(a), b.x + objW(b)) - Math.max(a.x, b.x);
		var overlapY = Math.min(a.y + objH(a), b.y + objH(b)) - Math.max(a.y, b.y);
		if (overlapX <= 0 || overlapY <= 0) return null;
		return { x: overlapX, y: overlapY };
	}

	// Pushes both objects apart along whichever axis has the smaller overlap,
	// then swaps their velocity on that axis (the standard equal-mass
	// elastic-collision trick). A plain "reflect using your own velocity"
	// works for two moving objects but leaves a stationary one dead in the
	// water (Math.abs(0) is still 0) - swapping correctly transfers
	// momentum into it either way.
	function resolveMutualCollision(a, b) {
		var ov = aabbOverlap(a, b);
		if (!ov) return false;

		if (ov.x < ov.y) {
			var pushX = ov.x / 2;
			if (a.x < b.x) { a.x -= pushX; b.x += pushX; }
			else { a.x += pushX; b.x -= pushX; }
			var avx = a.vx;
			a.vx = b.vx;
			b.vx = avx;
		} else {
			var pushY = ov.y / 2;
			if (a.y < b.y) { a.y -= pushY; b.y += pushY; }
			else { a.y += pushY; b.y -= pushY; }
			var avy = a.vy;
			a.vy = b.vy;
			b.vy = avy;
		}
		return true;
	}

	// --- Brick frame -------------------------------------------------------

	function layoutRun(start, end, unit) {
		var segments = [];
		var pos = start;
		while (pos < end) {
			var size = Math.min(unit, end - pos);
			segments.push({ pos: pos, size: size });
			pos += unit;
		}
		return segments;
	}

	function makeBrick(x, y, w, h, color) {
		var el = document.createElement('div');
		el.className = 'brick';
		el.style.left = x + 'px';
		el.style.top = y + 'px';
		el.style.width = w + 'px';
		el.style.height = h + 'px';
		el.style.backgroundColor = color;
		document.body.appendChild(el);

		var brick = { el: el, x: x, y: y, w: w, h: h, color: color, hp: 1 };
		el.addEventListener('click', function (e) {
			e.stopPropagation();
			explodeBrick(brick);
		});
		bricks.push(brick);
	}

	function clearBricks() {
		bricks.forEach(function (b) {
			if (b.el.parentNode) b.el.parentNode.removeChild(b.el);
		});
		bricks.length = 0;
	}

	function buildBricks() {
		var content = document.querySelector('.container');
		if (!content) return;

		clearBricks();

		var r = content.getBoundingClientRect();
		var left = r.left - FRAME_PADDING;
		var top = r.top - FRAME_PADDING;
		var right = r.right + FRAME_PADDING;
		var bottom = r.bottom + FRAME_PADDING;

		layoutRun(left, right, BRICK_UNIT).forEach(function (seg) {
			makeBrick(seg.pos, top, seg.size, BRICK_THICKNESS, BRICK_COLORS.top);
		});
		layoutRun(left, right, BRICK_UNIT).forEach(function (seg) {
			makeBrick(seg.pos, bottom - BRICK_THICKNESS, seg.size, BRICK_THICKNESS, BRICK_COLORS.bottom);
		});
		layoutRun(top + BRICK_THICKNESS, bottom - BRICK_THICKNESS, BRICK_UNIT).forEach(function (seg) {
			makeBrick(left, seg.pos, BRICK_THICKNESS, seg.size, BRICK_COLORS.left);
		});
		layoutRun(top + BRICK_THICKNESS, bottom - BRICK_THICKNESS, BRICK_UNIT).forEach(function (seg) {
			makeBrick(right - BRICK_THICKNESS, seg.pos, BRICK_THICKNESS, seg.size, BRICK_COLORS.right);
		});

		frameInner = {
			left: left + BRICK_THICKNESS,
			top: top + BRICK_THICKNESS,
			right: right - BRICK_THICKNESS,
			bottom: bottom - BRICK_THICKNESS
		};
	}

	function isInsideFrame(x, y, size) {
		if (!frameInner) return false;
		return x + size > frameInner.left && x < frameInner.right &&
			y + size > frameInner.top && y < frameInner.bottom;
	}

	function randomSpawnOutsideFrame(size) {
		var x, y, tries = 0;
		do {
			x = Math.random() * (window.innerWidth - size);
			y = Math.random() * (window.innerHeight - size);
			tries++;
		} while (isInsideFrame(x, y, size) && tries < 30);
		return { x: x, y: y };
	}

	// Heads chip away at whatever brick they hit: a full-size head deals a
	// full hit (destroys an undamaged brick outright), a half-size head
	// deals half a hit, a quarter-size head a quarter, and so on - damage is
	// just head.size / INITIAL_SIZE. The actual damage + split happens in
	// processBrickHits() after the frame's per-head loop finishes, so
	// mutating `heads` mid-iteration (removing the struck head, spawning its
	// two halves) can't disturb the loop that's still walking it.
	var pendingBrickHits = [];

	function resolveBrickCollision(head) {
		for (var i = 0; i < bricks.length; i++) {
			var b = bricks[i];

			var overlapX = Math.min(head.x + head.size, b.x + b.w) - Math.max(head.x, b.x);
			var overlapY = Math.min(head.y + head.size, b.y + b.h) - Math.max(head.y, b.y);

			if (overlapX > 0 && overlapY > 0) {
				if (overlapX < overlapY) {
					if (head.x < b.x) { head.x -= overlapX; head.vx = -Math.abs(head.vx); }
					else { head.x += overlapX; head.vx = Math.abs(head.vx); }
				} else {
					if (head.y < b.y) { head.y -= overlapY; head.vy = -Math.abs(head.vy); }
					else { head.y += overlapY; head.vy = Math.abs(head.vy); }
				}

				pendingBrickHits.push({ head: head, brick: b });
				return; // this head has struck a brick this frame; stop here
			}
		}
	}

	function processBrickHits() {
		for (var i = 0; i < pendingBrickHits.length; i++) {
			var hit = pendingBrickHits[i];
			var brick = hit.brick;
			var head = hit.head;

			if (bricks.indexOf(brick) === -1) continue; // already destroyed this frame

			brick.hp -= head.size / INITIAL_SIZE;
			if (brick.hp <= 0) {
				explodeBrick(brick);
			} else {
				brick.el.style.opacity = Math.max(0.3, brick.hp);
			}

			splitHead(head, head.x + head.size / 2, head.y + head.size / 2);
		}
		pendingBrickHits.length = 0;
	}

	function playBrickBreak() {
		playNoiseBurst(0.12, 'bandpass', 2200, 0.8, 0.3, 2);
	}

	function explodeBrick(brick) {
		var idx = bricks.indexOf(brick);
		if (idx === -1) return; // already exploded
		bricks.splice(idx, 1);
		if (brick.el.parentNode) brick.el.parentNode.removeChild(brick.el);

		var cx = brick.x + brick.w / 2;
		var cy = brick.y + brick.h / 2;
		var fragmentCount = 8;

		for (var i = 0; i < fragmentCount; i++) {
			var angle = Math.random() * Math.PI * 2;
			var dist = 25 + Math.random() * 35;
			var frag = document.createElement('div');
			frag.className = 'brick-fragment';
			frag.style.left = cx + 'px';
			frag.style.top = cy + 'px';
			frag.style.backgroundColor = brick.color;
			frag.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
			frag.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
			frag.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
			document.body.appendChild(frag);
			frag.addEventListener('animationend', function () {
				if (this.parentNode) this.parentNode.removeChild(this);
			});
		}

		playBrickBreak();
	}

	// --- Dislodgeables: any piece of real content marked .dislodgeable (the
	// social icons, the profile photo, the name, each line of the title) is
	// knocked loose when a head collides with it, then flies around and
	// bounces like a head until shot, at which point it flies straight back
	// to its original spot and goes back to being normal, in-place content.
	// -------------------------------------------------------------------

	function findDislodgeableByElement(el) {
		for (var i = 0; i < dislodgeables.length; i++) {
			if (dislodgeables[i].el === el) return dislodgeables[i];
		}
		return null;
	}

	function buildDislodgeables() {
		var els = document.querySelectorAll('.dislodgeable');
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			var existing = findDislodgeableByElement(el);
			if (existing) {
				if (existing.state === 'resting') {
					var rect = el.getBoundingClientRect();
					existing.homeX = rect.left;
					existing.homeY = rect.top;
					existing.x = rect.left;
					existing.y = rect.top;
					existing.width = rect.width;
					existing.height = rect.height;
				}
				continue;
			}

			var r = el.getBoundingClientRect();
			dislodgeables.push({
				el: el,
				width: r.width,
				height: r.height,
				homeX: r.left,
				homeY: r.top,
				x: r.left,
				y: r.top,
				vx: 0,
				vy: 0,
				rotation: 0,
				rotationSpeed: 0,
				state: 'resting',
				placeholder: null
			});
		}
	}

	function resolveBrickCollisionRect(obj) {
		for (var i = 0; i < bricks.length; i++) {
			var b = bricks[i];

			var overlapX = Math.min(obj.x + obj.width, b.x + b.w) - Math.max(obj.x, b.x);
			var overlapY = Math.min(obj.y + obj.height, b.y + b.h) - Math.max(obj.y, b.y);

			if (overlapX > 0 && overlapY > 0) {
				if (overlapX < overlapY) {
					if (obj.x < b.x) { obj.x -= overlapX; obj.vx = -Math.abs(obj.vx); }
					else { obj.x += overlapX; obj.vx = Math.abs(obj.vx); }
				} else {
					if (obj.y < b.y) { obj.y -= overlapY; obj.vy = -Math.abs(obj.vy); }
					else { obj.y += overlapY; obj.vy = Math.abs(obj.vy); }
				}
			}
		}
	}

	function dislodge(obj, dirVx, dirVy) {
		obj.state = 'dislodged';
		obj.rotation = 0;
		obj.rotationSpeed = ROTATION_SPEED * (Math.random() < 0.5 ? -1 : 1);

		var speed = Math.sqrt(dirVx * dirVx + dirVy * dirVy) || BASE_SPEED;
		var knockSpeed = speed * 1.1 + 40;
		obj.vx = (dirVx / speed) * knockSpeed;
		obj.vy = (dirVy / speed) * knockSpeed;

		// Going position:fixed pulls the element out of the document flow,
		// which would otherwise let its siblings collapse into the gap and
		// end up visually underneath it. A same-sized, same-margin placeholder
		// holds the spot open until it comes home.
		var cs = getComputedStyle(obj.el);
		var placeholder = document.createElement('span');
		placeholder.className = 'dislodge-placeholder';
		// Icon-buttons sit side-by-side in a row (display:inline-block); every
		// other dislodgeable already effectively owns its whole line, so a
		// plain block placeholder avoids inline-vs-empty-inline-block
		// line-height/baseline quirks (this bit an <img>, which is naturally
		// `display:inline` but was the sole content of its line).
		placeholder.style.display = cs.display === 'inline-block' ? 'inline-block' : 'block';
		placeholder.style.width = obj.width + 'px';
		placeholder.style.height = obj.height + 'px';
		placeholder.style.marginTop = cs.marginTop;
		placeholder.style.marginRight = cs.marginRight;
		placeholder.style.marginBottom = cs.marginBottom;
		placeholder.style.marginLeft = cs.marginLeft;
		obj.el.parentNode.insertBefore(placeholder, obj.el);
		obj.placeholder = placeholder;

		obj.el.classList.add('dislodged');
		obj.el.style.position = 'fixed';
		obj.el.style.left = '0';
		obj.el.style.top = '0';
		obj.el.style.margin = '0';
		obj.el.style.zIndex = '6';
		obj.el.style.transform = 'translate(' + obj.x + 'px, ' + obj.y + 'px) rotate(0deg)';
	}

	function returnHome(obj) {
		if (obj.state !== 'dislodged') return;
		obj.state = 'returning';
	}

	function settle(obj) {
		obj.x = obj.homeX;
		obj.y = obj.homeY;
		obj.state = 'resting';
		obj.el.classList.remove('dislodged');
		obj.el.style.position = '';
		obj.el.style.left = '';
		obj.el.style.top = '';
		obj.el.style.margin = '';
		obj.el.style.zIndex = '';
		obj.el.style.transform = '';
		if (obj.placeholder && obj.placeholder.parentNode) {
			obj.placeholder.parentNode.removeChild(obj.placeholder);
		}
		obj.placeholder = null;
	}

	function checkDislodgeCollisions(head) {
		for (var i = 0; i < dislodgeables.length; i++) {
			var obj = dislodgeables[i];
			if (obj.state !== 'resting') continue;

			var overlapX = Math.min(head.x + head.size, obj.homeX + obj.width) - Math.max(head.x, obj.homeX);
			var overlapY = Math.min(head.y + head.size, obj.homeY + obj.height) - Math.max(head.y, obj.homeY);

			if (overlapX > 0 && overlapY > 0) {
				var incomingVx = head.vx, incomingVy = head.vy; // knock using the head's approach direction, before its own bounce flips it

				if (overlapX < overlapY) {
					if (head.x < obj.homeX) { head.x -= overlapX; head.vx = -Math.abs(head.vx); }
					else { head.x += overlapX; head.vx = Math.abs(head.vx); }
				} else {
					if (head.y < obj.homeY) { head.y -= overlapY; head.vy = -Math.abs(head.vy); }
					else { head.y += overlapY; head.vy = Math.abs(head.vy); }
				}
				dislodge(obj, incomingVx, incomingVy);
			}
		}
	}

	function moveDislodgeables(delta, screenW, screenH) {
		for (var i = 0; i < dislodgeables.length; i++) {
			var obj = dislodgeables[i];
			if (obj.state === 'resting') continue;

			if (obj.state === 'dislodged') {
				obj.x += obj.vx * delta;
				obj.y += obj.vy * delta;
				obj.rotation += obj.rotationSpeed * delta;

				resolveBrickCollisionRect(obj);

				if (obj.x + obj.width < 0) obj.x = screenW;
				else if (obj.x > screenW) obj.x = -obj.width;
				if (obj.y + obj.height < 0) obj.y = screenH;
				else if (obj.y > screenH) obj.y = -obj.height;
			} else if (obj.state === 'returning') {
				var dx = obj.homeX - obj.x;
				var dy = obj.homeY - obj.y;
				var dist = Math.sqrt(dx * dx + dy * dy);
				var step = RETURN_SPEED * delta;

				if (dist <= step) {
					settle(obj);
				} else {
					obj.x += (dx / dist) * step;
					obj.y += (dy / dist) * step;
					obj.rotation += obj.rotationSpeed * delta * 0.3;
				}
			}
		}
	}

	// Heads bouncing off already-dislodged content, and dislodged content
	// bouncing off other dislodged content. Resting content is handled by
	// checkDislodgeCollisions (it triggers a dislodge instead of a plain
	// bounce); returning content glides home and ignores collisions so a
	// shot reliably sends it all the way back.
	function checkMutualBounces() {
		for (var i = 0; i < heads.length; i++) {
			var head = heads[i];
			for (var j = 0; j < dislodgeables.length; j++) {
				var obj = dislodgeables[j];
				if (obj.state !== 'dislodged') continue;
				resolveMutualCollision(head, obj);
			}
		}

		for (var a = 0; a < dislodgeables.length; a++) {
			var objA = dislodgeables[a];
			if (objA.state !== 'dislodged') continue;
			for (var b = a + 1; b < dislodgeables.length; b++) {
				var objB = dislodgeables[b];
				if (objB.state !== 'dislodged') continue;
				resolveMutualCollision(objA, objB);
			}
		}
	}

	function renderDislodgeables() {
		for (var i = 0; i < dislodgeables.length; i++) {
			var obj = dislodgeables[i];
			if (obj.state === 'resting') continue;
			obj.el.style.transform = 'translate(' + obj.x + 'px, ' + obj.y + 'px) rotate(' + obj.rotation + 'deg)';
		}
	}

	// --- Heads ---------------------------------------------------------

	function attachHead(el, size, x, y, vx, vy) {
		el.style.width = size + 'px';
		el.style.height = size + 'px';

		var head = {
			el: el,
			size: size,
			x: x,
			y: y,
			vx: vx,
			vy: vy,
			rotation: Math.random() * 360,
			rotationSpeed: ROTATION_SPEED * (Math.random() < 0.5 ? -1 : 1),
			age: 0
		};

		heads.push(head);
		return head;
	}

	function spawnHead(size, x, y, vx, vy) {
		var img = document.createElement('img');
		img.src = IMG_SRC;
		img.alt = '';
		img.setAttribute('aria-hidden', 'true');
		img.className = 'floating-head';
		document.body.appendChild(img);
		return attachHead(img, size, x, y, vx, vy);
	}

	function removeHead(head) {
		var idx = heads.indexOf(head);
		if (idx !== -1) heads.splice(idx, 1);
		if (head.el && head.el.parentNode) {
			head.el.parentNode.removeChild(head.el);
		}
	}

	function splitHead(head, clickX, clickY) {
		var newSize = head.size / 2;
		if (newSize < MIN_SIZE) return; // too small to split further

		removeHead(head);

		// Send the two halves roughly opposite directions (with jitter) so they
		// reliably separate instead of sometimes launching at similar angles and
		// drifting straight back into merge range.
		var baseAngle = Math.random() * Math.PI * 2;
		var jitter = Math.PI / 3; // +/- 30 degrees

		for (var i = 0; i < 2; i++) {
			var angle = baseAngle + (i === 0 ? 0 : Math.PI) + (Math.random() - 0.5) * jitter;
			var speed = BASE_SPEED * (1 + Math.random() * 0.8);
			spawnHead(
				newSize,
				clickX - newSize / 2,
				clickY - newSize / 2,
				Math.cos(angle) * speed,
				Math.sin(angle) * speed
			);
		}
	}

	function mergeHeads(a, b) {
		var newSize = Math.min(a.size + b.size, MAX_SIZE);
		var cx = (a.x + a.size / 2 + b.x + b.size / 2) / 2;
		var cy = (a.y + a.size / 2 + b.y + b.size / 2) / 2;
		var vx = (a.vx + b.vx) / 2;
		var vy = (a.vy + b.vy) / 2;

		removeHead(a);
		removeHead(b);

		spawnHead(newSize, cx - newSize / 2, cy - newSize / 2, vx, vy);
	}

	// Two heads that touch either merge (if both are past their cooldown) or
	// simply bounce off each other, same as everything else.
	function checkHeadCollisions() {
		var pairs = [];
		var consumed = {};

		for (var i = 0; i < heads.length; i++) {
			if (consumed[i]) continue;
			var a = heads[i];

			for (var j = i + 1; j < heads.length; j++) {
				if (consumed[j]) continue;
				var b = heads[j];

				if (!aabbOverlap(a, b)) continue;

				if (a.age >= MERGE_COOLDOWN && b.age >= MERGE_COOLDOWN) {
					consumed[i] = true;
					consumed[j] = true;
					pairs.push([a, b]);
					break;
				}

				resolveMutualCollision(a, b);
			}
		}

		pairs.forEach(function (pair) {
			mergeHeads(pair[0], pair[1]);
		});
	}

	function frame(time) {
		if (lastTime === null) lastTime = time;
		var delta = (time - lastTime) / 1000;
		lastTime = time;

		var screenW = window.innerWidth;
		var screenH = window.innerHeight;

		// 1. Move everything and resolve collisions against the static bricks
		// and, for heads, against resting dislodgeables (which may knock one
		// loose).
		for (var i = 0; i < heads.length; i++) {
			var head = heads[i];

			head.age += delta;
			head.x += head.vx * delta;
			head.y += head.vy * delta;
			head.rotation += head.rotationSpeed * delta;

			resolveBrickCollision(head);
			checkDislodgeCollisions(head);

			// Wrap around screen edges, Asteroids-style, instead of bouncing.
			if (head.x + head.size < 0) head.x = screenW;
			else if (head.x > screenW) head.x = -head.size;

			if (head.y + head.size < 0) head.y = screenH;
			else if (head.y > screenH) head.y = -head.size;
		}

		processBrickHits(); // apply damage + split any heads that struck a brick this frame

		moveDislodgeables(delta, screenW, screenH);

		// 2. Now that everything has moved, resolve every remaining pairing:
		// head-vs-head (bounce or merge), head-vs-dislodged, and
		// dislodged-vs-dislodged - so everything bounces off everything.
		checkMutualBounces();
		checkHeadCollisions();

		// 3. Render final positions.
		for (var k = 0; k < heads.length; k++) {
			var h = heads[k];
			h.el.style.transform = 'translate(' + h.x + 'px, ' + h.y + 'px) rotate(' + h.rotation + 'deg)';
		}
		renderDislodgeables();

		requestAnimationFrame(frame);
	}

	// --- Shooting: a click anywhere that isn't on real page content fires a
	// shot. Hit detection uses a generous circle around each head instead of
	// requiring a pixel-exact click, and a Duck Hunt-style flash + gunshot
	// sound play regardless of whether anything was actually hit.

	function playGunshot() {
		playNoiseBurst(0.15, 'lowpass', 1500, undefined, 0.35, 3);
	}

	function showMuzzleFlash(x, y, hit) {
		var ring = document.createElement('div');
		ring.className = 'shot-flash' + (hit ? ' shot-flash-hit' : '');
		ring.style.left = x + 'px';
		ring.style.top = y + 'px';
		document.body.appendChild(ring);
		ring.addEventListener('animationend', function () {
			if (ring.parentNode) ring.parentNode.removeChild(ring);
		});
	}

	function fireShot(x, y) {
		var hitAny = false;

		for (var i = heads.length - 1; i >= 0; i--) {
			var head = heads[i];
			var cx = head.x + head.size / 2;
			var cy = head.y + head.size / 2;
			var dx = x - cx, dy = y - cy;
			var dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < head.size / 2 + HIT_TOLERANCE) {
				hitAny = true;
				splitHead(head, x, y);
			}
		}

		for (var j = 0; j < dislodgeables.length; j++) {
			var obj = dislodgeables[j];
			if (obj.state !== 'dislodged') continue;

			// A full rectangle test (plus the usual tolerance margin) instead
			// of an averaged circle, so a long text line or the photo is
			// hittable anywhere across its actual width/height, not just near
			// its center.
			if (x >= obj.x - HIT_TOLERANCE && x <= obj.x + obj.width + HIT_TOLERANCE &&
				y >= obj.y - HIT_TOLERANCE && y <= obj.y + obj.height + HIT_TOLERANCE) {
				hitAny = true;
				returnHome(obj);
			}
		}

		showMuzzleFlash(x, y, hitAny);
		playGunshot();
	}

	document.addEventListener('click', function (e) {
		// A brick explodes on its own click and never counts as a shot.
		var brickEl = e.target.closest && e.target.closest('.brick');
		if (brickEl) return; // the brick's own listener (with stopPropagation) already handled it

		// A dislodged/returning piece of content (which may itself be, or
		// contain, a real <a href>) would otherwise navigate away on click -
		// block that and let the hit-circle check below send it home instead.
		// Resting content (or any other real content) is untouched.
		var dislodgeableEl = e.target.closest && e.target.closest('.dislodgeable');
		var obj = dislodgeableEl ? findDislodgeableByElement(dislodgeableEl) : null;
		if (obj && obj.state !== 'resting') {
			e.preventDefault();
		} else if (e.target.closest && e.target.closest('.container')) {
			// Legitimate, visible page content (headings, the photo, links) opts
			// back into pointer-events inside .container; anything else - the
			// black background, or a head itself, which is pointer-events:none -
			// bubbles up as a click on body/html and counts as a shot.
			return;
		}

		fireShot(e.clientX, e.clientY);
	});

	var initial = document.querySelector('img.floating-head');
	if (!initial) return;

	buildBricks();
	buildDislodgeables();
	window.addEventListener('resize', function () {
		buildBricks();
		buildDislodgeables();
	});

	var start = randomVelocity(BASE_SPEED);
	var spawn = randomSpawnOutsideFrame(INITIAL_SIZE);

	attachHead(initial, INITIAL_SIZE, spawn.x, spawn.y, start.vx, start.vy);

	requestAnimationFrame(frame);
})();
