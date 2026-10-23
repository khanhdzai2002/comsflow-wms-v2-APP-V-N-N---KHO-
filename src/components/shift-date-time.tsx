import { useId } from "react";

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);

export function ShiftDateTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [date, time = "00:00"] = value.split("T");
  const [hour, minute] = time.split(":");
  return (
    <fieldset className="field shift-date-time">
      <legend>{label} (giờ Việt Nam)</legend>
      <div className="shift-date-time-controls">
        <label htmlFor={id + "-date"}>
          Ngày
          <input
            id={id + "-date"}
            aria-label={label + " · Ngày"}
            type="date"
            required
            value={date}
            onChange={(e) => onChange(`${e.target.value}T${time}`)}
          />
        </label>
        <label htmlFor={id + "-hour"}>
          Giờ (00–23)
          <select
            id={id + "-hour"}
            aria-label={label + " · Giờ"}
            value={hour}
            onChange={(e) => onChange(`${date}T${e.target.value}:${minute}`)}
          >
            {hours.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label htmlFor={id + "-minute"}>
          Phút
          <select
            id={id + "-minute"}
            aria-label={label + " · Phút"}
            value={minute}
            onChange={(e) => onChange(`${date}T${hour}:${e.target.value}`)}
          >
            {minutes.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
