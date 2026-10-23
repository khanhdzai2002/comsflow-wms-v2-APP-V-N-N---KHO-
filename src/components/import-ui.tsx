"use client";
import { useId, useState } from "react";
import { Check, FileText, FileSpreadsheet, UploadCloud, X } from "lucide-react";

export function ImportSteps({
  current,
  complete = false,
}: {
  current: 1 | 2 | 3;
  complete?: boolean;
}) {
  return (
    <ol className="import-steps" aria-label="Tiến trình nhập dữ liệu">
      {["Chọn file", "Kiểm tra dữ liệu", "Xác nhận lưu"].map((label, i) => {
        const step = i + 1;
        const done = complete || step < current;
        return (
          <li
            key={label}
            className={done ? "complete" : step === current ? "current" : ""}
            aria-current={!complete && step === current ? "step" : undefined}
          >
            <span className="import-step-number">
              {done ? <Check size={16} /> : step}
            </span>
            <span>
              {label}
              <small>
                {done
                  ? "Đã xong"
                  : step === current
                    ? "Đang thực hiện"
                    : "Bước tiếp theo"}
              </small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function FilePicker({
  label,
  accept,
  files,
  onFiles,
  onRemove,
  disabled = false,
  multiple = false,
  pdf = false,
  showFiles = true,
  help,
}: {
  label: string;
  accept: string;
  files: File[];
  onFiles: (files: File[]) => void;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  multiple?: boolean;
  pdf?: boolean;
  showFiles?: boolean;
  help: string;
}) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const Icon = pdf ? FileText : FileSpreadsheet;
  return (
    <div
      className={`file-picker ${dragging ? "dragging" : ""} ${disabled ? "busy" : ""}`}
    >
      <div className="file-picker-heading">
        <strong>{label}</strong>
        <span>
          {files.length ? `Đã chọn ${files.length} file` : "Chưa chọn file"}
        </span>
      </div>
      <label
        htmlFor={id}
        className="file-picker-zone"
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled && event.dataTransfer.files.length)
            onFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          id={id}
          aria-label={label}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.files?.length)
              onFiles(Array.from(event.target.files));
            event.target.value = "";
          }}
        />
        <span className="file-picker-symbol">
          <UploadCloud size={26} />
        </span>
        <span className="file-picker-copy">
          <strong>
            {disabled
              ? "Đang xử lý file…"
              : "Kéo thả file vào đây hoặc bấm để chọn"}
          </strong>
          <span>{help}</span>
        </span>
        <span className="file-picker-choose">
          Chọn file {pdf ? "PDF" : "Excel / CSV"}
        </span>
      </label>
      {showFiles && files.length > 0 && (
        <ul className="picked-files" aria-label="File đã chọn">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span className="picked-file-icon">
                <Icon size={22} />
              </span>
              <span className="picked-file-name">
                <strong title={file.name}>{file.name}</strong>
                <small>
                  {file.size >= 1024 * 1024
                    ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                    : file.size >= 1024
                      ? `${(file.size / 1024).toFixed(1)} KB`
                      : `${file.size} B`}{" "}
                  · File đã chọn
                </small>
              </span>
              {onRemove && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  className="file-remove"
                  aria-label={`Bỏ file ${file.name}`}
                >
                  <X size={16} /> Bỏ file
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
