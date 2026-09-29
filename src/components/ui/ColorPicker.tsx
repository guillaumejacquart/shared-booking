/** Nuancier : pastilles prédéfinies + couleur libre. */
export default function ColorPicker({
  value,
  presets,
  onChange,
  label,
}: {
  value: string;
  presets: string[];
  onChange: (color: string) => void;
  label: string;
}) {
  const swatches = presets.includes(value) ? presets : [...presets, value];
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label={label}>
      {swatches.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={color}
          onClick={() => onChange(color)}
          style={{ backgroundColor: color }}
          className={`h-7 w-7 rounded-full transition-all duration-200 ${
            color === value
              ? "scale-110 ring-2 ring-brand ring-offset-2 ring-offset-card"
              : "hover:scale-105 opacity-75 hover:opacity-100"
          }`}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-7 cursor-pointer appearance-none rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
        aria-label={`${label} (libre)`}
        title={`${label} (libre)`}
      />
    </div>
  );
}
