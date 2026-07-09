# Route C Media Upload Image Compression

Status: active draft for P179

Updated: 2026-07-04

## Contract

P179 makes the normal Route C chat image payload a bounded display derivative
for supported static image uploads. The derivative is generated before Matrix
media upload, so upload, storage, sync, timeline fetch, and decode all use the
bounded bytes.

Required display-derivative bounds:

```text
max long edge <= 1280px
preserve aspect ratio
do not upscale smaller images
quality ~= 0.75 for lossy JPEG/WebP output
```

The Matrix event `url` points at the display derivative. Its `info` fields
describe the derivative dimensions, byte size, and mimetype.

## Supported And Skipped Inputs

The P179 source path targets browser-decodable static images:

```text
image/jpeg
image/png
image/webp
```

Non-image attachments are unchanged. Unsupported or unsafe image inputs are not
silently corrupted. Animated GIF, animated WebP, animated PNG, HEIC/HEIF, decode
failures, canvas failures, already-bounded images, and derivatives that are not
smaller keep the original upload bytes and record an explicit diagnostic
`skip_reason`.

The first P179 implementation does not upload a second full-size original copy.
That preserves the accepted latency goal: normal chat send and reload paths use
the display derivative only.

## Diagnostics

Route C records P179 diagnostics in event metadata, not visible product UI, under
`org.oysterun.p179.image_display_derivative`.

The diagnostic record includes:

```text
original_name
original_mimetype
original_byte_size
original_width
original_height
display_mimetype
display_byte_size
display_width
display_height
max_long_edge
quality
compression_ms
was_compressed
compression_ratio
skip_reason
```

`skip_reason` is present only when the upload uses original bytes.

## P160 Preservation

P179 does not change P160 product-message identity.

One Send with multiple images still commits one
`org.oysterun.multi_media` Matrix event with one shared caption. Each attachment
keeps its ordered `index`, `content_uri`, `filename`, derivative `info`, and its
own optional P179 diagnostic record. Provider delivery remains one saved-path
prompt for the whole product message.

## Non-Goals

P179 does not redesign Matrix SDK upload internals, change non-image attachment
behavior, add visible compression settings, or preserve full-size originals as a
second upload.
