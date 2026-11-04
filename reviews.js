// Reviews sent from the PeraPlan app. Everything is written with textContent
// (never innerHTML), so a review can only ever show up as plain text.
(function () {
  var box = document.getElementById('reviews');
  var summary = document.getElementById('reviews-summary');
  if (!box) return;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }

  function stars(n) {
    n = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  function note(text) {
    box.textContent = '';
    box.appendChild(el('p', 'muted', text));
  }

  fetch('reviews-config.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      var url = String(cfg.endpoint || '');
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
        note('Reviews are coming soon. You can write one from the app: More → Rate PeraPlan.');
        return null;
      }
      return fetch(url + '?action=list').then(function (r) { return r.json(); });
    })
    .then(function (data) {
      if (!data) return;
      if (!data.ok) return note('Reviews could not be loaded right now.');
      if (summary && data.count) {
        summary.textContent = stars(data.average) + '  ' + Number(data.average).toFixed(1) + ' / 5 · ' + Number(data.count) + ' review' + (data.count === 1 ? '' : 's');
      }
      box.textContent = '';
      if (!data.reviews || !data.reviews.length) return note('No reviews yet. Be the first — from the app: More → Rate PeraPlan.');
      data.reviews.forEach(function (r) {
        var card = el('div', 'card review');
        var head = el('div', 'review-head');
        head.appendChild(el('span', 'review-name', r.name));
        head.appendChild(el('span', 'review-stars', stars(r.stars)));
        card.appendChild(head);
        card.appendChild(el('p', 'review-text', r.text));
        if (r.date) card.appendChild(el('span', 'muted', new Date(Number(r.date)).toLocaleDateString()));
        box.appendChild(card);
      });
    })
    .catch(function () { note('Reviews could not be loaded right now.'); });
})();
