# Hỗ trợ file preview desktop

## Trạng thái

Đã triển khai và kiểm chứng trên `fix/preview-file`. Full Playwright E2E đạt 61 test, 23 intentional skip, 0 unexpected và 0 flaky. UI đạt 7539 test; Electron đạt 2297 test với 7 pending; Python đạt 18 test. Typecheck, lint, build, runtime preview và whitespace check đều đạt. Chưa commit, push, mở PR hoặc deploy.

## Definition of done

Các fixture thật cho `.xlsx`, `.csv`, `.tsv`, `.zip`, `.docx`, `.pptx`, audio, video và ảnh remote đi qua đúng hành vi quan sát được. Parser từ chối input vượt giới hạn. Card file local không còn đề nghị tải lại file đã có. Các test tập trung, typecheck, lint và build liên quan đều đạt.

## Phạm vi

1. Chuẩn hóa họ định dạng và giới hạn preview.
2. Thêm parser có giới hạn cho bảng tính, archive và OOXML text.
3. Thêm renderer bảng, tài liệu, archive và media trong right rail.
4. Phân biệt hành động card local và remote.
5. Đồng bộ allowlist stream ảnh remote.
6. Chạy test, typecheck, review độc lập và kiểm chứng app thực tế khi khả thi.

## Không làm

Không hỗ trợ `.xls`, `.ods`, `.7z`, `.rar`, `.psd`, `.fig` hoặc `.sketch`. Không chạy macro. Không hứa tái tạo layout Word hoặc PowerPoint.

## Rủi ro

File ZIP không tin cậy có thể gây tiêu thụ bộ nhớ hoặc CPU. Mọi đường parse phải giới hạn bytes đầu vào, số entry, kích thước giải nén, hàng, cột và sheet.

## Decision trail

Xem `decisions.tsv`.
