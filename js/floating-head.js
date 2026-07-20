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
	var icons = [];
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

		var brick = { el: el, x: x, y: y, w: w, h: h, color: color };
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
			}
		}
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

	// --- Social icons: knocked loose when a head collides with them, then
	// fly around and bounce like a head until shot, at which point they fly
	// straight back to their original spot and go back to being a normal
	// link. -----------------------------------------------------------------

	function findIconByElement(el) {
		for (var i = 0; i < icons.length; i++) {
			if (icons[i].el === el) return icons[i];
		}
		return null;
	}

	function buildIcons() {
		var els = document.querySelectorAll('.icon-button');
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			var existing = findIconByElement(el);
			if (existing) {
				if (existing.state === 'resting') {
					var rect = el.getBoundingClientRect();
					existing.homeX = rect.left;
					existing.homeY = rect.top;
					existing.x = rect.left;
					existing.y = rect.top;
					existing.size = rect.width;
				}
				continue;
			}

			var r = el.getBoundingClientRect();
			icons.push({
				el: el,
				size: r.width,
				homeX: r.left,
				homeY: r.top,
				x: r.left,
				y: r.top,
				vx: 0,
				vy: 0,
				rotation: 0,
				rotationSpeed: 0,
				state: 'resting'
			});
		}
	}

	function dislodgeIcon(icon, dirVx, dirVy) {
		icon.state = 'dislodged';
		icon.rotation = 0;
		icon.rotationSpeed = ROTATION_SPEED * (Math.random() < 0.5 ? -1 : 1);

		var speed = Math.sqrt(dirVx * dirVx + dirVy * dirVy) || BASE_SPEED;
		var knockSpeed = speed * 1.1 + 40;
		icon.vx = (dirVx / speed) * knockSpeed;
		icon.vy = (dirVy / speed) * knockSpeed;

		// Going position:fixed pulls the icon out of the inline-block row,
		// which would otherwise let its siblings collapse into the gap and
		// end up visually underneath it. A same-sized placeholder holds the
		// spot open until the icon comes home.
		var placeholder = document.createElement('span');
		placeholder.className = 'icon-placeholder';
		placeholder.style.display = 'inline-block';
		placeholder.style.width = icon.size + 'px';
		placeholder.style.height = icon.size + 'px';
		icon.el.parentNode.insertBefore(placeholder, icon.el);
		icon.placeholder = placeholder;

		icon.el.classList.add('icon-dislodged');
		icon.el.style.position = 'fixed';
		icon.el.style.left = '0';
		icon.el.style.top = '0';
		icon.el.style.zIndex = '6';
		icon.el.style.transform = 'translate(' + icon.x + 'px, ' + icon.y + 'px) rotate(0deg)';
	}

	function returnIconHome(icon) {
		if (icon.state !== 'dislodged') return;
		icon.state = 'returning';
	}

	function settleIcon(icon) {
		icon.x = icon.homeX;
		icon.y = icon.homeY;
		icon.state = 'resting';
		icon.el.classList.remove('icon-dislodged');
		icon.el.style.position = '';
		icon.el.style.left = '';
		icon.el.style.top = '';
		icon.el.style.zIndex = '';
		icon.el.style.transform = '';
		if (icon.placeholder && icon.placeholder.parentNode) {
			icon.placeholder.parentNode.removeChild(icon.placeholder);
		}
		icon.placeholder = null;
	}

	function checkIconDislodge(head) {
		for (var i = 0; i < icons.length; i++) {
			var icon = icons[i];
			if (icon.state !== 'resting') continue;

			var overlapX = Math.min(head.x + head.size, icon.homeX + icon.size) - Math.max(head.x, icon.homeX);
			var overlapY = Math.min(head.y + head.size, icon.homeY + icon.size) - Math.max(head.y, icon.homeY);

			if (overlapX > 0 && overlapY > 0) {
				var incomingVx = head.vx, incomingVy = head.vy; // knock the icon using the head's approach direction, before its own bounce flips it

				if (overlapX < overlapY) {
					if (head.x < icon.homeX) { head.x -= overlapX; head.vx = -Math.abs(head.vx); }
					else { head.x += overlapX; head.vx = Math.abs(head.vx); }
				} else {
					if (head.y < icon.homeY) { head.y -= overlapY; head.vy = -Math.abs(head.vy); }
					else { head.y += overlapY; head.vy = Math.abs(head.vy); }
				}
				dislodgeIcon(icon, incomingVx, incomingVy);
			}
		}
	}

	function updateIcons(delta, screenW, screenH) {
		for (var i = 0; i < icons.length; i++) {
			var icon = icons[i];
			if (icon.state === 'resting') continue;

			if (icon.state === 'dislodged') {
				icon.x += icon.vx * delta;
				icon.y += icon.vy * delta;
				icon.rotation += icon.rotationSpeed * delta;

				resolveBrickCollision(icon);

				if (icon.x + icon.size < 0) icon.x = screenW;
				else if (icon.x > screenW) icon.x = -icon.size;
				if (icon.y + icon.size < 0) icon.y = screenH;
				else if (icon.y > screenH) icon.y = -icon.size;

				icon.el.style.transform = 'translate(' + icon.x + 'px, ' + icon.y + 'px) rotate(' + icon.rotation + 'deg)';
			} else if (icon.state === 'returning') {
				var dx = icon.homeX - icon.x;
				var dy = icon.homeY - icon.y;
				var dist = Math.sqrt(dx * dx + dy * dy);
				var step = RETURN_SPEED * delta;

				if (dist <= step) {
					settleIcon(icon);
				} else {
					icon.x += (dx / dist) * step;
					icon.y += (dy / dist) * step;
					icon.rotation += icon.rotationSpeed * delta * 0.3;
					icon.el.style.transform = 'translate(' + icon.x + 'px, ' + icon.y + 'px) rotate(' + icon.rotation + 'deg)';
				}
			}
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

	function checkMerges() {
		var pairs = [];
		var consumed = {};

		for (var i = 0; i < heads.length; i++) {
			if (consumed[i]) continue;
			var a = heads[i];
			if (a.age < MERGE_COOLDOWN) continue;

			for (var j = i + 1; j < heads.length; j++) {
				if (consumed[j]) continue;
				var b = heads[j];
				if (b.age < MERGE_COOLDOWN) continue;

				var ax = a.x + a.size / 2, ay = a.y + a.size / 2;
				var bx = b.x + b.size / 2, by = b.y + b.size / 2;
				var dx = ax - bx, dy = ay - by;
				var dist = Math.sqrt(dx * dx + dy * dy);

				if (dist < (a.size + b.size) / 2) {
					consumed[i] = true;
					consumed[j] = true;
					pairs.push([a, b]);
					break;
				}
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

		for (var i = 0; i < heads.length; i++) {
			var head = heads[i];

			head.age += delta;
			head.x += head.vx * delta;
			head.y += head.vy * delta;
			head.rotation += head.rotationSpeed * delta;

			resolveBrickCollision(head);
			checkIconDislodge(head);

			// Wrap around screen edges, Asteroids-style, instead of bouncing.
			if (head.x + head.size < 0) head.x = screenW;
			else if (head.x > screenW) head.x = -head.size;

			if (head.y + head.size < 0) head.y = screenH;
			else if (head.y > screenH) head.y = -head.size;

			head.el.style.transform = 'translate(' + head.x + 'px, ' + head.y + 'px) rotate(' + head.rotation + 'deg)';
		}

		updateIcons(delta, screenW, screenH);
		checkMerges();

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

		for (var j = 0; j < icons.length; j++) {
			var icon = icons[j];
			if (icon.state !== 'dislodged') continue;

			var icx = icon.x + icon.size / 2;
			var icy = icon.y + icon.size / 2;
			var idx = x - icx, idy = y - icy;
			var idist = Math.sqrt(idx * idx + idy * idy);

			if (idist < icon.size / 2 + HIT_TOLERANCE) {
				hitAny = true;
				returnIconHome(icon);
			}
		}

		showMuzzleFlash(x, y, hitAny);
		playGunshot();
	}

	document.addEventListener('click', function (e) {
		// A brick explodes on its own click and never counts as a shot.
		var brickEl = e.target.closest && e.target.closest('.brick');
		if (brickEl) return; // the brick's own listener (with stopPropagation) already handled it

		// A dislodged/returning icon is still a real <a href> in the DOM, so a
		// click on it would otherwise navigate away - block that and let the
		// hit-circle check below send it home instead. A resting icon (or any
		// other real content) is untouched and behaves like a normal link.
		var iconEl = e.target.closest && e.target.closest('.icon-button');
		var icon = iconEl ? findIconByElement(iconEl) : null;
		if (icon && icon.state !== 'resting') {
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
	buildIcons();
	window.addEventListener('resize', function () {
		buildBricks();
		buildIcons();
	});

	var start = randomVelocity(BASE_SPEED);
	var spawn = randomSpawnOutsideFrame(INITIAL_SIZE);

	attachHead(initial, INITIAL_SIZE, spawn.x, spawn.y, start.vx, start.vy);

	requestAnimationFrame(frame);
})();
