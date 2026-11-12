# IELTS Speaking Part 1 và Part 2

Ứng dụng học cá nhân sử dụng tài liệu từ IELTS TIME. Mỗi bài trong `data/db.json` có tên nhà xuất bản và URL gốc riêng, cùng tác giả và URL audio nếu có. Bản GitHub Pages công khai giao diện và transcript, cho phép tìm kiếm và lọc theo phần thi, nguồn và loại tài liệu.

## Chạy trên máy

Dùng Node.js 24 để chạy cùng phiên bản với GitHub Actions.

```sh
npm ci
npm run dev
```

Mở `http://127.0.0.1:5173/`. Vite đọc `data/db.json` và các file đồng bộ trực tiếp từ dự án.

Chạy kiểm tra và xem bản build cho GitHub Pages.

```sh
npm test
npm run build
npm run typecheck
npm run preview
```

Mở `http://127.0.0.1:4173/ielts-speaking-study/`. Chạy build trước typecheck để plugin TanStack Router tạo cây route.

`npm run dev:private` mở giao diện cũ qua máy chủ Python 3.11 với Basic Auth. Nhập username và password trong terminal rồi mở `http://127.0.0.1:8000/`. Máy chủ lắng nghe trên loopback và tạm chặn sau 5 lần thử sai trong một phút. Để chạy không tương tác, đặt `IELTS_USERNAME` và `IELTS_PASSWORD` trong môi trường cục bộ.

## Cập nhật dữ liệu

Dùng Python 3.11 trở lên để tạo môi trường cho crawler.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python crawl_ielts_part1.py --validate
.venv/bin/python crawl_ielts_part1.py --part all
```

Crawler đọc `robots.txt`, duyệt danh mục Part 1 và Part 2, rồi chỉ mở URL bài chi tiết chưa được xử lý. Bài yêu cầu hội viên được bỏ qua và crawler chỉ ghi nhớ URL để tránh tải lại vào tuần sau. Nếu nguồn trả `429` hoặc yêu cầu chờ khi bảo trì, crawler dừng lượt chạy và ghi thời gian chờ từ nguồn nếu có. Crawler chỉ ghi đè database sau khi xử lý xong và kiểm tra dữ liệu hợp lệ.

Để thử lại tối đa 10 bài cũ đang thiếu transcript, chạy `.venv/bin/python crawl_ielts_part1.py --repair-missing 10`.

Trong dữ liệu Part 1 đã nhập trước đó có 33 URL audio trực tiếp, 20 URL video YouTube nhúng và 24 liên kết hội viên. Dữ liệu cũ được giữ nguyên. Quy tắc bỏ qua bài hội viên áp dụng cho các lượt nhập mới.

## GitHub Pages

Trang React dùng TanStack Router và được Vite đóng gói thành website tĩnh. `index.html` ở thư mục gốc là đầu vào của Vite. GitHub Pages phục vụ `dist/index.html` tại [IELTS Speaking Study](https://long-le-mt.github.io/ielts-speaking-study/). Link bài như `?lesson=shoes` tiếp tục mở cùng trang index.

Trong repository, chọn **Settings → Pages → Source → GitHub Actions**. Workflow **Deploy IELTS study site** dùng Node.js 24, cài dependency theo lockfile, chạy test, build và typecheck trước khi upload `dist`. Workflow chạy khi các file liên quan thay đổi trên `master`, khi chọn **Run workflow**, hoặc sau khi workflow cập nhật catalog hay đồng bộ câu trên `master` hoàn tất. Mã phiên bản dùng SHA của commit đã checkout cùng số workflow run và lần thử.

Khi build, Vite tạo `catalog.json` chứa metadata để tìm kiếm và lọc toàn bộ thư viện, cùng một file `lessons/<hash>.json` cho từng bài. Trang tải danh mục trước và lấy transcript, nhãn người nói, mốc thời gian của bài được chọn khi cần. Các lần quay lại bài đã mở dùng dữ liệu trong bộ nhớ. Workflow kiểm tra từng file bài với database gốc trước khi deploy.

Vite đặt hash nội dung trong tên bundle JavaScript, CSS và font. URL tải JSON dùng `?v=<version>`. Trang kiểm tra `version.json` khi mở, khi quay lại tab và định kỳ mỗi phút. Khi có phiên bản mới, trang tải lại và khôi phục vị trí phát của bài đang mở nếu trình duyệt cho phép session storage. Các file `app.js` và `styles.css` ở đường dẫn cũ giúp tab đang giữ HTML cũ chuyển sang phiên bản mới.

## Transcript đồng bộ audio

Chọn **Materials → Synced** để tìm các bài có mốc thời gian từng câu. Khi phát audio, câu đang đọc được tô sáng. Bấm vào câu để tua và phát từ câu đó, dùng **Replay sentence** để nghe lại và bật **Repeat sentence** để lặp câu đã chọn. **Follow audio** điều khiển việc tự cuộn theo câu đang đọc.

Người nói và các phần phỏng vấn của năm bài được đối chiếu với nội dung transcript và lưu trong `public/dialogue.json`. Câu hỏi hiển thị dưới **Interviewer**, phần trả lời có tên **Joseph**, **Blondie** hoặc **Ivanna**, còn lời dẫn và nhận xét nằm trong các phần riêng. Nhãn người nói chỉ được dùng khi transcript hiện tại khớp với bản đã kiểm tra.

Mốc thời gian từng câu nằm trong `public/alignment.json`, được tạo từ audio gốc và transcript. Vite đóng gói file này cùng giao diện, nên trang GitHub Pages chạy trực tiếp từ dữ liệu đã xử lý. Workflow **Sync IELTS sentence cues** chạy sau lần cập nhật catalog thành công và khi dữ liệu hoặc công cụ căn chỉnh thay đổi trên `master`. Nếu có bài cần xử lý, tối đa bốn runner tự cài FFmpeg và các thư viện căn chỉnh trên CPU. Kết quả được kiểm tra theo audio, transcript và mốc thời gian của catalog mới nhất trước khi lưu và deploy. Bài đã đồng bộ hợp lệ được bỏ qua ở lượt sau.

Để tạo lại mốc thời gian, cài FFmpeg trên máy và cài thêm Stable-ts vào môi trường Python. Mô hình `base.en` được tải trong lần chạy đầu, rồi căn chỉnh trên CPU.

```sh
.venv/bin/python -m pip install stable-ts
.venv/bin/python scripts/align_transcripts.py --database data/db.json --output public/alignment.json --all-missing --cache-dir /tmp/ielts-alignment-cache
npm run build
```

## GitHub Actions cập nhật dữ liệu

Workflow **Update IELTS TIME catalog** chạy lúc 03:23 thứ Hai hằng tuần theo giờ Việt Nam trên nhánh mặc định và có nút **Run workflow**. Mỗi tuần, crawler kiểm tra một nhóm tối đa 12 bài đã có transcript đang thiếu audio trực tiếp. Nếu nguồn giới hạn truy cập, bước này dừng và workflow tiếp tục với catalog đã lưu. Crawler chỉ commit và push `data/db.json` khi file hợp lệ và có thay đổi. Nhánh mặc định cần cho phép token của workflow push. Thư mục crawl cũ `data/speaking-part-1/` được Git bỏ qua.

## Speaking Part 2

Để khởi tạo hoặc cập nhật riêng [Speaking Part 2](https://theieltstime.com/category/ielts-speaking-part-2/), chạy:

```sh
.venv/bin/python crawl_ielts_part1.py --part 2
```

Có thể thêm `--limit 15` để xử lý tối đa 15 URL bài mới mỗi lượt. Chạy lại cùng lệnh để tiếp tục từ các URL chưa xử lý.

## Thêm nguồn khác

Mỗi bài có `source.website` (tên nhà xuất bản) và `source.url` (URL HTTPS của bài gốc), cùng `source.author` nếu có. Thư viện dùng URL gốc để kiểm tra trùng, vì các nguồn khác nhau có thể dùng cùng slug. Khi thêm nguồn, cần viết trình thu thập riêng theo cấu trúc và điều kiện truy cập của nguồn đó. Bộ lọc nguồn lấy tên từ dữ liệu.
