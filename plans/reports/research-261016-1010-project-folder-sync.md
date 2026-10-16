# Điều tra folder local trong Lemon AI

**Phạm vi:** Lemon AI Desktop, nhánh `fix/require-1`, 2026-10-16. Người dùng làm rõ: project gắn với folder thường ở máy local; tạo folder con bằng Finder/File Explorer thì thấy trong app, nhưng xóa bằng trình quản lý thư mục thì folder vẫn hiện và không xóa được trong app. Đã sửa theo lựa chọn làm mới khi quay lại Lemon AI; chưa kiểm chứng bằng ứng dụng Electron thật.

## Đính chính kết luận trước

Báo cáo ban đầu tập trung vào project lưu trong `projects.db` và Git repo tự phát hiện. **Đó không phải luồng giải thích hiện tượng folder con thường.** Bề mặt phù hợp là cây **Files** ở thanh bên phải, nhận `cwd` của session rồi đọc thư mục thực trên máy qua Electron. [Right sidebar](../../apps/desktop/src/app/right-sidebar/index.tsx#L28-L52) · [Filesystem IPC](../../apps/desktop/electron/fs-ipc.ts#L31) · [Directory read](../../apps/desktop/electron/fs-read-dir.ts#L81-L108)

## Nguyên nhân theo code

1. Trước bản sửa, `useProjectTree` giữ các node đã đọc trong atom; root chỉ được tải lại khi `cwd`/connection đổi, sự kiện `workspaceChangeTick` (thay đổi từ agent/ứng dụng), hoặc người dùng bấm **Refresh**. Khi đó chưa có sự kiện focus/visibility hoặc filesystem watcher gắn với cây Files cho thay đổi thực hiện bằng Finder/File Explorer. [State và loadRoot](../../apps/desktop/src/app/right-sidebar/files/use-project-tree.ts#L113-L155) · [Các effect làm mới](../../apps/desktop/src/app/right-sidebar/files/use-project-tree.ts#L468-L490) · [Nút Refresh](../../apps/desktop/src/app/right-sidebar/index.tsx#L86-L103)
2. Lần đọc thư mục tiếp theo dùng filesystem thực qua `readDesktopDir`, không phải một bản cache entries ở IPC. Khi đọc lại thành công, `mergeChildren` bỏ các node đã biến mất; nhánh reconcile toàn cây cũng chỉ giữ các entry còn được trả về. Vì **thiếu trigger đọc lại từ thay đổi ngoài app**, row đã xóa vẫn là dữ liệu cũ trên màn hình. [readProjectDir](../../apps/desktop/src/app/right-sidebar/files/ipc.ts#L133-L142) · [Filesystem read](../../apps/desktop/electron/fs-read-dir.ts#L89-L108) · [Merge](../../apps/desktop/src/app/right-sidebar/files/use-project-tree.ts#L70-L77) · [Reconcile](../../apps/desktop/src/app/right-sidebar/files/use-project-tree.ts#L336-L366)
3. Khi bấm chuột phải **Delete** trên row cũ, app gọi `shell.trashItem(path)` rồi mới phát sự kiện làm mới. Nếu đường dẫn đã bị xóa bằng Finder/File Explorer, thao tác trash có thể thất bại; lỗi được hộp xác nhận hiển thị và không phát `notifyWorkspaceChanged()`. Chưa tái hiện để khẳng định thông báo lỗi cụ thể trên máy người báo. [Menu](../../apps/desktop/src/app/right-sidebar/file-actions.tsx#L93-L128) · [Store](../../apps/desktop/src/store/file-actions.ts#L108-L118) · [IPC trash](../../apps/desktop/electron/fs-ipc.ts#L190-L202) · [Confirm lỗi](../../apps/desktop/src/components/ui/confirm-dialog.tsx#L95-L125)

**Giới hạn chứng cứ:** Code không cho thấy watcher tự thêm folder thường khi Finder tạo nó. Folder mới có thể hiện sau thao tác refresh, đổi cwd, hoặc sự kiện workspace khác. Sự khác biệt thêm/xóa trong lời kể là hiện tượng thực tế cần test, chưa đủ để kết luận có đồng bộ realtime một chiều.

## Giải pháp đã chọn và triển khai

- Khi người dùng quay lại cửa sổ Lemon AI (`focus` hoặc `visibilitychange` khi hiện lại), revalidate **root và các thư mục con đã tải** bằng `revalidateTree` sẵn có. Lần đọc thành công bỏ folder/file đã mất; lần đọc lỗi giữ cây cũ. Không thêm watcher. [Hook](../../apps/desktop/src/app/right-sidebar/files/use-project-tree.ts#L380-L520)
- Có generation guard cho các lượt revalidate đồng thời: lượt đọc cũ về muộn không ghi đè lượt mới. [Revalidate](../../apps/desktop/src/app/right-sidebar/files/use-project-tree.ts#L289-L371)
- Test hồi quy chứng minh đỏ→xanh: folder root và nested bị xóa biến mất khi focus, lỗi đọc giữ cây, lượt focus cũ về muộn không hồi sinh folder. [Tests](../../apps/desktop/src/app/right-sidebar/files/use-project-tree.test.ts#L163-L240)
- Nếu sau này cần cập nhật **ngay cả khi Lemon AI vẫn foreground**, phải xét watcher root và các thư mục đã mở hoặc một lịch refresh khi pane hiển thị; không nằm trong scope lần này.

Không nên sửa `projects.db`, quét Git repo hoặc nhánh remote để xử lý lỗi này: chúng không phải nguồn danh sách folder con của cây Files.

## Kiểm chứng

- Hai test focus ban đầu **thất bại đúng lý do** khi chưa thêm listener: folder cũ vẫn hiện, không có lần đọc tiếp theo. Test race cũng thất bại khi lượt cũ hồi sinh folder, rồi đạt sau generation guard.
- `npm --prefix apps/desktop run test:ui -- src/app/right-sidebar/index.test.tsx src/app/right-sidebar/files/ipc.test.ts src/app/right-sidebar/files/use-project-tree.test.ts`: **32/32 pass**.
- `npm --prefix apps/desktop run typecheck`: pass; `npm --prefix apps/desktop run lint -- --quiet`: pass; `git diff --check`: pass.
- Chưa chạy Electron thật để mô phỏng Finder/File Explorer; kiểm chứng hiện tại ở mức hook/IPC test.

## Câu hỏi còn mở

- Không có quyết định sản phẩm nào còn chờ cho scope “cập nhật khi quay lại”. Kiểm chứng trực tiếp trên ứng dụng đóng gói vẫn chưa thực hiện.
