(function () {
	var img = document.getElementById('floating-head');
	if (!img) return;

	var size = 100;
	var x = Math.random() * (window.innerWidth - size);
	var y = Math.random() * (window.innerHeight - size);
	var speed = 80; // px per second
	var angle = Math.random() * Math.PI * 2;
	var vx = Math.cos(angle) * speed;
	var vy = Math.sin(angle) * speed;
	var rotation = 0;
	var rotationSpeed = 60; // deg per second
	var lastTime = null;

	function frame(time) {
		if (lastTime === null) lastTime = time;
		var delta = (time - lastTime) / 1000;
		lastTime = time;

		x += vx * delta;
		y += vy * delta;
		rotation += rotationSpeed * delta;

		var maxX = window.innerWidth - size;
		var maxY = window.innerHeight - size;

		if (x <= 0) { x = 0; vx = Math.abs(vx); }
		else if (x >= maxX) { x = maxX; vx = -Math.abs(vx); }

		if (y <= 0) { y = 0; vy = Math.abs(vy); }
		else if (y >= maxY) { y = maxY; vy = -Math.abs(vy); }

		img.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + rotation + 'deg)';

		requestAnimationFrame(frame);
	}

	requestAnimationFrame(frame);
})();
