(function () {
	var IMG_SRC = 'floating-head.png';
	var MIN_SIZE = 20; // heads smaller than this no longer split
	var BASE_SPEED = 80; // px per second
	var ROTATION_SPEED = 60; // deg per second

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
			rotationSpeed: ROTATION_SPEED * (Math.random() < 0.5 ? -1 : 1)
		};

		el.addEventListener('click', function (e) {
			splitHead(head, e.clientX, e.clientY);
		});

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

		for (var i = 0; i < 2; i++) {
			var speed = BASE_SPEED * (1 + Math.random() * 0.8);
			var dir = randomVelocity(speed);
			spawnHead(
				newSize,
				clickX - newSize / 2,
				clickY - newSize / 2,
				dir.vx,
				dir.vy
			);
		}
	}

	function frame(time) {
		if (lastTime === null) lastTime = time;
		var delta = (time - lastTime) / 1000;
		lastTime = time;

		var screenW = window.innerWidth;
		var screenH = window.innerHeight;

		for (var i = 0; i < heads.length; i++) {
			var head = heads[i];

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

		requestAnimationFrame(frame);
	}

	var initial = document.querySelector('img.floating-head');
	if (!initial) return;

	var size = 100;
	var x = Math.random() * (window.innerWidth - size);
	var y = Math.random() * (window.innerHeight - size);
	var start = randomVelocity(BASE_SPEED);

	attachHead(initial, size, x, y, start.vx, start.vy);

	requestAnimationFrame(frame);
})();
