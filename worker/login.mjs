export function loginPage(message = '', status = 200, headers = {}) {
  // Messages are fixed strings from the Worker, never values from the request.
  const notice = message ? `<p class="notice" role="alert">${message}</p>` : '';
  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đăng nhập · IELTS Speaking Part 1</title>
  <style>
    :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #25342d; background: #f4f5ef; }
    * { box-sizing: border-box; }
    body { margin: 0; display: grid; place-items: center; min-height: 100vh; min-height: 100dvh; padding: 24px; }
    main { width: min(100%, 430px); padding: clamp(24px, 8vw, 40px); background: #fff; border: 1px solid #dce1d8; border-radius: 20px; box-shadow: 0 18px 42px #243a2e12; }
    h1 { margin: 0 0 20px; font: 600 clamp(1.7rem, 6vw, 2.3rem)/1.18 Georgia, serif; }
    .context { margin: 0 0 6px; color: #486352; font-size: .9rem; font-weight: 600; }
    .notice { margin: 0 0 18px; padding: 10px 12px; border-radius: 8px; color: #842620; background: #fcebe9; }
    label { display: grid; gap: 6px; margin: 0 0 16px; font-weight: 600; }
    input, button { font: inherit; border-radius: 8px; padding: 10px 12px; }
    input { min-width: 0; color: inherit; border: 1px solid #a6b3a9; }
    button { width: 100%; cursor: pointer; border: 0; color: #fff; background: #28533e; font-weight: 650; }
    button:hover { background: #1f4231; }
    :focus-visible { outline: 3px solid #307452; outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <p class="context">IELTS Speaking Part 1</p>
    <h1>Đăng nhập</h1>
    ${notice}
    <form action="/login" method="post">
      <label>Tên đăng nhập <input name="username" autocomplete="username" maxlength="128" required></label>
      <label>Mật khẩu <input name="password" type="password" autocomplete="current-password" maxlength="256" required></label>
      <button type="submit">Đăng nhập</button>
    </form>
  </main>
</body>
</html>`;
  return new Response(html, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}
