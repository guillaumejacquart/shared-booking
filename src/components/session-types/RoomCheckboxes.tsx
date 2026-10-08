import { t } from "@/lib/i18n";
import { Checkbox, Field } from "@/components/ui";

/** Salles compatibles d'un type de séance (vide = toutes). */
export default function RoomCheckboxes({
  rooms,
  selected,
  onChange,
}: {
  rooms: { id: string; name: string }[];
  selected: string[];
  onChange: (roomIds: string[]) => void;
}) {
  if (rooms.length === 0) return null;
  function toggle(roomId: string, checked: boolean) {
    onChange(checked ? [...selected, roomId] : selected.filter((id) => id !== roomId));
  }
  return (
    <div className="mt-2">
      <Field
        label={t("sessionTypesAdmin.compatibleRooms")}
        hintAside={t("sessionTypesAdmin.compatibleRoomsHint")}
      >
        <div className="flex flex-wrap gap-3">
          {rooms.map((room) => (
            <label key={room.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(room.id)}
                onChange={(event) => toggle(room.id, event.target.checked)}
              />
              {room.name}
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}
