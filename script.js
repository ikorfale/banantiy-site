const clock = document.querySelector('#utc-clock');
const year = document.querySelector('#year');

function tick() {
  const now = new Date();
  clock.textContent = `UTC ${now.toISOString().slice(11, 19)}`;
  year.textContent = String(now.getUTCFullYear());
}

tick();
setInterval(tick, 1000);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveals = document.querySelectorAll('.reveal');

if (reduced || !('IntersectionObserver' in window)) {
  reveals.forEach((item) => item.classList.add('visible'));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  reveals.forEach((item) => observer.observe(item));
}
