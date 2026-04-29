import React, { useEffect } from 'react';

// Simple confetti using canvas (no dependency)
export default function Confetti({ trigger, duration = 1800 }) {
  useEffect(() => {
    if (!trigger) return;
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.left = 0;
    canvas.style.top = 0;
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = 9999;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const pieces = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      r: 6 + Math.random() * 8,
      d: 8 + Math.random() * 8,
      color: `hsl(${Math.random() * 360},90%,60%)`,
      tilt: Math.random() * 10,
      tiltAngle: 0,
      tiltAngleInc: 0.05 + Math.random() * 0.07,
      speed: 2 + Math.random() * 2
    }));
    let running = true;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r, p.r / 2, p.tilt, 0, 2 * Math.PI);
        ctx.fillStyle = p.color;
        ctx.fill();
      });
    }
    function update() {
      pieces.forEach(p => {
        p.y += p.speed;
        p.tilt += p.tiltAngleInc;
        if (p.y > canvas.height + 20) {
          p.x = Math.random() * canvas.width;
          p.y = -20;
        }
      });
    }
    function loop() {
      if (!running) return;
      draw();
      update();
      requestAnimationFrame(loop);
    }
    loop();
    const timeout = setTimeout(() => {
      running = false;
      document.body.removeChild(canvas);
    }, duration);
    return () => {
      running = false;
      clearTimeout(timeout);
      if (canvas.parentNode) document.body.removeChild(canvas);
    };
  }, [trigger, duration]);
  return null;
}
