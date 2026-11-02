# DocAligner model

`lcnet100_h_e_bifpn_256_fp32.onnx` is the `lcnet100` heatmap model of
**DocAligner** by **DocsaidLab** (<https://github.com/DocsaidLab/DocAligner>),
used unmodified to find the corners of a photographed pallet sheet.

- Licence: Apache License 2.0 (full text in [`LICENSE`](./LICENSE)).
  The maintainers confirmed that the model weights are Apache-2.0 and may be
  used commercially, bundled and quantised:
  <https://github.com/DocsaidLab/DocAligner/issues/13#issuecomment-6056145224>
- Source: the official download referenced in
  `docaligner/heatmap_reg/infer.py` (Google Drive file
  `1IlbLPkCv-TdaBLOPh_4J97P1_KHYYJ7a`); byte-identical to
  `docaligner-lcnet100.onnx` in the mirror
  <https://huggingface.co/kittypdf/DocAligner-ONNX>.
- SHA-256: `f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e`
- Input `img` float32 `[1, 3, 256, 256]` (BGR, ÷ 255); output `heatmap`
  float32 `[1, 4, 128, 128]` (top-left, top-right, bottom-right, bottom-left).

Copyright DocsaidLab. Licensed under the Apache License, Version 2.0; you may
not use this file except in compliance with the License. Unless required by
applicable law or agreed to in writing, software distributed under the
License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS
OF ANY KIND, either express or implied.
