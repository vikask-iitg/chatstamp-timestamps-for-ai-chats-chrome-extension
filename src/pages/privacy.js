// Privacy page: shows PRIVACY.md, so the policy has one source. Kept out of the HTML
// because extension pages can't run inline scripts.
(function () {
  const policy = document.getElementById('policy');
  fetch('../../PRIVACY.md')
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    })
    .then((text) => {
      policy.innerHTML = ChatStamp.markdownToHtml(text);
    })
    .catch(() => {
      policy.textContent = "The privacy policy couldn't be loaded. It's also in PRIVACY.md in the project's GitHub repository.";
    });
})();
