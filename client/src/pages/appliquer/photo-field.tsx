import { useEffect, useRef, useState } from 'react'
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from '../../artist-profile'

type Props = { value: File | null; onChange: (file: File | null) => void; invalid: boolean }

export function PhotoField({ value, onChange, invalid }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  // The address of the photo picked, to show it, made when it's picked and released once it's replaced or the form is
  // gone. When the browser doesn't know the photo's type, it's shown anyway: the server tells it from its contents.
  const [preview, setPreview] = useState<string | null>(null)
  const shown = useRef<string | null>(null)
  useEffect(() => () => {
    if (shown.current) URL.revokeObjectURL(shown.current)
  }, [])

  const pick = (file: File | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current)
    shown.current = file && (!file.type || PHOTO_TYPES.includes(file.type)) ? URL.createObjectURL(file) : null
    setPreview(shown.current)
    onChange(file)
  }

  return (
    <div className={invalid ? 'photo invalid' : 'photo'}>
      {preview ? (
        <img src={preview} alt="Aperçu de votre photo" />
      ) : (
        <div className="photo-empty" aria-hidden="true">
          photo
        </div>
      )}
      <div className="photo-side">
        {/* The native file input can't be styled: it stays hidden, and the button (which the label points at)
            opens it. */}
        <input
          ref={input}
          type="file"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          accept={PHOTO_TYPES.join(',')}
          onChange={(event) => pick(event.target.files?.[0] ?? null)}
        />
        <button ref={button} id="photo" type="button" aria-invalid={invalid || undefined} onClick={() => input.current?.click()}>
          {value ? 'changer de photo' : 'choisir une photo'}
        </button>
        {value && (
          <>
            <span className="photo-name">{value.name}</span>
            <button
              type="button"
              onClick={() => {
                // So that picking the same file again still counts as a change.
                if (input.current) input.current.value = ''
                pick(null)
                // This button goes away, so the focus goes to the one that picks a photo rather than being lost.
                button.current?.focus()
              }}
            >
              retirer la photo
            </button>
          </>
        )}
        <span className="hint">JPEG, PNG ou WebP, jusqu'à {PHOTO_MAX_BYTES / 1024 / 1024} Mo.</span>
      </div>
    </div>
  )
}
