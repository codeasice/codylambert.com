(function () {
	var IMG_SRC = 'floating-head.png';
	var INITIAL_SIZE = 100;
	var MAX_SIZE = INITIAL_SIZE; // merging never grows heads past the original size
	var MIN_SIZE = 6; // heads smaller than this no longer split
	var BASE_SPEED = 80; // px per second
	var ROTATION_SPEED = 60; // deg per second
	var MERGE_COOLDOWN = 0.6; // seconds before a freshly spawned head can merge (avoids re-merging siblings instantly)
	var HIT_TOLERANCE = 20; // extra px of forgiveness beyond a head's own radius when aiming

	var heads = [];
	var lastTime = null;

	function randomVelocity(speed) {
		var angle = Math.random() * Math.PI * 2;
		return {
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed
		};
	}

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

			var maxX = screenW - head.size;
			var maxY = screenH - head.size;

			if (head.x <= 0) { head.x = 0; head.vx = Math.abs(head.vx); }
			else if (head.x >= maxX) { head.x = maxX; head.vx = -Math.abs(head.vx); }

			if (head.y <= 0) { head.y = 0; head.vy = Math.abs(head.vy); }
			else if (head.y >= maxY) { head.y = maxY; head.vy = -Math.abs(head.vy); }

			head.el.style.transform = 'translate(' + head.x + 'px, ' + head.y + 'px) rotate(' + head.rotation + 'deg)';
		}

		checkMerges();

		requestAnimationFrame(frame);
	}

	// --- Shooting: a click anywhere that isn't on real page content fires a
	// shot. Hit detection uses a generous circle around each head instead of
	// requiring a pixel-exact click, and a Duck Hunt-style flash + gunshot
	// sound play regardless of whether anything was actually hit.

	function playGunshot() {
		try {
			var Ctx = window.AudioContext || window.webkitAudioContext;
			if (!Ctx) return;
			var ctx = new Ctx();
			var duration = 0.15;
			var bufferSize = Math.floor(ctx.sampleRate * duration);
			var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
			var data = buffer.getChannelData(0);
			for (var i = 0; i < bufferSize; i++) {
				data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
			}

			var noise = ctx.createBufferSource();
			noise.buffer = buffer;

			var filter = ctx.createBiquadFilter();
			filter.type = 'lowpass';
			filter.frequency.value = 1500;

			var gain = ctx.createGain();
			gain.gain.setValueAtTime(0.35, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

			noise.connect(filter);
			filter.connect(gain);
			gain.connect(ctx.destination);
			noise.start();
			noise.stop(ctx.currentTime + duration);
			noise.onended = function () { ctx.close(); };
		} catch (e) {
			// Audio unavailable/blocked - the visual flash still plays.
		}
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

		showMuzzleFlash(x, y, hitAny);
		playGunshot();
	}

	document.addEventListener('click', function (e) {
		// Legitimate, visible page content (headings, the photo, links) opts
		// back into pointer-events inside .container; anything else - the
		// black background, or a head itself, which is pointer-events:none -
		// bubbles up as a click on body/html and counts as a shot.
		if (e.target.closest && e.target.closest('.container')) return;
		fireShot(e.clientX, e.clientY);
	});

	var initial = document.querySelector('img.floating-head');
	if (!initial) return;

	var x = Math.random() * (window.innerWidth - INITIAL_SIZE);
	var y = Math.random() * (window.innerHeight - INITIAL_SIZE);
	var start = randomVelocity(BASE_SPEED);

	attachHead(initial, INITIAL_SIZE, x, y, start.vx, start.vy);

	requestAnimationFrame(frame);
})();
