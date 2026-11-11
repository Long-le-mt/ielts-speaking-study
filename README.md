# IELTS Speaking Part 1 và Part 2

Ứng dụng học cá nhân sử dụng tài liệu từ IELTS TIME. Mỗi bài trong `data/db.json` có tên nhà xuất bản và URL gốc riêng, cùng tác giả và URL audio nếu có. Giao diện đọc dữ liệu sau khi đăng nhập, cho phép tìm kiếm và lọc theo phần thi, nguồn và loại tài liệu.

## Chạy trên máy

Yêu cầu Python 3.11 trở lên.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python crawl_ielts_part1.py --validate
.venv/bin/python serve_study.py
```

Nhập username và password trong terminal rồi mở `http://127.0.0.1:8000`. Trình duyệt sẽ hỏi cùng thông tin đăng nhập. Máy chủ chỉ lắng nghe trên loopback và tạm chặn sau 5 lần thử sai trong một phút. Dùng mật khẩu riêng cho ứng dụng này. Khi cần chạy không tương tác, đặt `IELTS_USERNAME` và `IELTS_PASSWORD` trong môi trường cục bộ.

## Cập nhật dữ liệu

```sh
.venv/bin/python crawl_ielts_part1.py --part all
```

Crawler đọc `robots.txt`, duyệt danh mục Part 1 và Part 2, rồi chỉ mở URL bài chi tiết chưa được xử lý. Bài yêu cầu hội viên được bỏ qua và crawler chỉ ghi nhớ URL để tránh tải lại vào tuần sau. Nếu nguồn trả `429` hoặc yêu cầu chờ khi bảo trì, crawler dừng lượt chạy và ghi thời gian chờ từ nguồn nếu có. Crawler chỉ ghi đè database sau khi xử lý xong và kiểm tra dữ liệu hợp lệ.

Để thử lại tối đa 10 bài cũ đang thiếu transcript, chạy `.venv/bin/python crawl_ielts_part1.py --repair-missing 10`.

Trong dữ liệu Part 1 đã nhập trước đó có 33 URL audio trực tiếp, 20 URL video YouTube nhúng và 24 liên kết hội viên. Dữ liệu cũ được giữ nguyên. Quy tắc bỏ qua bài hội viên áp dụng cho các lượt nhập mới.

## GitHub Actions

1. Push dự án lên **repository private**. Transcript được lưu với phạm vi sử dụng cá nhân. Thư mục crawl cũ `data/speaking-part-1/` được Git bỏ qua.
2. Workflow **Update IELTS TIME catalog** chạy lúc 03:23 thứ Hai hằng tuần theo giờ Việt Nam trên nhánh mặc định và có nút **Run workflow**. Nó chỉ commit và push `data/db.json` khi file hợp lệ và có thay đổi. Nhánh mặc định cần cho phép token của workflow push.
3. Kéo thay đổi từ repo private về máy để giao diện đọc bản `db.json` mới. GitHub Actions chạy crawler theo lịch. Máy chủ học chạy riêng trên máy cá nhân bằng `serve_study.py`.

Các file Wrangler và Worker cũ được giữ để tham chiếu. Luồng chạy hiện tại không sử dụng chúng.

## Speaking Part 2

Để khởi tạo hoặc cập nhật riêng [Speaking Part 2](https://theieltstime.com/category/ielts-speaking-part-2/), chạy:

```sh
.venv/bin/python crawl_ielts_part1.py --part 2
```

Có thể thêm `--limit 15` để xử lý tối đa 15 URL bài mới mỗi lượt. Chạy lại cùng lệnh để tiếp tục từ các URL chưa xử lý.

## Thêm nguồn khác

Mỗi bài có `source.website` (tên nhà xuất bản) và `source.url` (URL HTTPS của bài gốc), cùng `source.author` nếu có. Thư viện dùng URL gốc để kiểm tra trùng, vì các nguồn khác nhau có thể dùng cùng slug. Khi thêm nguồn, cần viết trình thu thập riêng theo cấu trúc và điều kiện truy cập của nguồn đó. Bộ lọc nguồn lấy tên từ dữ liệu.
