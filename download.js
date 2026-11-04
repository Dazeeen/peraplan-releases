// Point "Download" straight at the newest APK (and show its size), so people
// don't grab the wrong file from the releases page.
(function () {
  var btn = document.getElementById('download');
  var info = document.getElementById('download-info');
  if (!btn) return;
  fetch('https://api.github.com/repos/Dazeeen/peraplan-releases/releases/latest')
    .then(function (r) { return r.json(); })
    .then(function (rel) {
      var apk = (rel.assets || []).filter(function (a) { return /\.apk$/i.test(a.name); })[0];
      if (!apk || !/^https:\/\/github\.com\//.test(apk.browser_download_url)) return;
      btn.href = apk.browser_download_url;
      btn.textContent = 'Download ' + String(rel.tag_name || '').replace(/[^0-9A-Za-z.\-]/g, '');
      if (info) info.textContent = 'Android 13 and up · ' + (apk.size / 1048576).toFixed(0) + ' MB';
    })
    .catch(function () {});
})();
