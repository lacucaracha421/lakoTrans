# FLUX native 전환 후 실제 보관함 품질 회귀 조사

기준: `e27adabb`, 앱 3.1.1, Windows / RTX 4090. 앱 버전이나 원격 release를
변경하지 않는 로컬 개발 수정이다. `library` 원본, 기존 지우기 결과 및 chapter
메타데이터는 수정하지 않았다. 실제 페이지를 `.tmp/flux-quality-20261004`로 복사해
production bubble-layout prepass, typography mask, Flux engine 및 최종 합성을 실행했다.

## 변경과 근거

- `tools/mgt-flux-klein-runner/src/model.rs`의 상태 묘사형 지시문을
  `Remove all text and sound effects, including large bold black katakana lettering. Preserve the existing speech bubbles and the original artwork.`로
  바꾼다. 같은 입력과 seed에서 기존 지시문은 컬러 제목·대사를 남기거나 말풍선을
  회색/청록색으로 채웠다. 짧은 `Remove all text.`는 말풍선까지 없애므로 기각했다.
- 말풍선과 그림 위 글자를 같은 지시문으로 처리하지 않는다. `patternPageMask`의
  job-local `bubbleMask` 유무를 `speechBubbleWindows`로 전달한다. typography
  feather/hard constraint는 효과음에도 존재하므로 말풍선 판정에 사용하지 않는다.
  공유 창 병합 뒤에도 hint 순서를 유지하고, 개수 불일치는 처리 전에 거부한다.
  worker의 선택적 `speech_bubble`이 true이면 효과음 강조 전의 윤곽 보존 지시문을
  사용한다. false/생략이면 굵은 효과음 강조 지시문을 사용한다. 마스크·픽셀 소유권은
  바꾸지 않는다. 말풍선 일반화에 실패한 전체 강조 후보의 5페이지 가로선과,
  `Leave speech bubbles empty`가 효과음 테두리를 새 말풍선으로 만드는 실패를
  `final-inclusive`, `bubble-empty`에 보존했다.
- seed를 임의 값 대신 42로 고정한다. 재처리 결과와 품질 비교를 재현하기 위한 값이며
  모든 이미지에 최적이라는 뜻은 아니다. 0, 1, 1337에서는 제목을 새 말풍선으로
  바꾸는 등 실패가 재현됐다.
- `tools/runner-image-processing/src/flux.rs`의 native 문맥을 64에서 96픽셀로
  넓힌다. 64픽셀은 긴 효과음 말풍선 내부에 곡선을 만들었고, 128픽셀 또는 app crop
  전체를 쓰면 작은 말풍선에 주변 칸 선을 끌어오는 경우가 있었다. 문맥 확대는
  최종 쓰기 마스크를 확대하지 않는다.
- native crop은 생성된 문맥 전체를 원래 좌표에 되돌린다. native model mask로 다시
  합성하지 않는다. 최종 core/feather/hard constraint의 권위는 기존 앱 합성 경로에
  유지한다. 같은 깨끗한 생성 결과에 native mask 합성만 다시 적용했을 때 글자 조각이
  되살아나는 독립 실험은 `native-double-composite.png`에 보존했다.

모델 Q4_K_M, Qwen3 encoder, small decoder, Euler / Flux2 scheduler, 4 steps,
CFG 1 및 앱의 block 소유권/검출 마스크 계약은 유지한다. 검출 마스크를 벗어난
원문을 강제로 지우거나 진단용 source-glyph evidence를 production mask로 사용하지 않는다.

## 실험 자료

로컬 증거 루트는 `.tmp/flux-quality-20261004`다. 이미지가 포함된 자료는 저장소에
추가하지 않는다. `fixtures.json`은 실제 production crop 입력/마스크와 요청 인자를
기록한다. 각 variant의 `requests.json`, `stdout.log`, `stderr.log`, PNG를 보존한다.

| 비교                                                        | 판단                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| 기존 지시문, 짧은 삭제, 상세 삭제, 원본 보존 등 지시문 변형 | 원문 잔존·새 말풍선·말풍선 삭제를 직접 비교              |
| reference edit only / masked init+reference                 | reference edit only는 형태 변경이 커서 기각              |
| 기존 VAE / small decoder                                    | VAE 교체만으로 회귀가 해결되지 않아 유지                 |
| 4 / 8 steps                                                 | 더 많은 step만으로 삭제 실패가 해결되지 않아 4 유지      |
| seed 42 / 0 / 1 / 1337                                      | 실패 재현성과 제목·효과음·윤곽 보존 비교                 |
| broad model mask / typography envelope만 model mask         | 확인한 실패를 해결하지 못해 기존 계약 유지               |
| native context 64 / 96 / 128 / app crop 전체                | 96 후보 채택; 전체 문맥의 새 선 발생은 기각              |
| Q4_K_M / Q8_0, Q8 seed 42 / 0                               | Q8에서도 잔여 효과음·가짜 곡선 발생, 기본 모델 교체 기각 |

Q8 실험 파일은 `unsloth/FLUX.2-klein-4B-GGUF` revision
`0084d1df98e2e2137fe776d55170bc4792ec1d66`의 `flux-2-klein-4b-Q8_0.gguf`다.
다운로드 SHA-256 `24a812e8f9b640e21c784164ea48571d8017ca22873696f4badeeabb006d509c`를
확인했다. production 모델 파일을 덮어쓰지 않았다.

`chapter-r1`은 지시문/seed만 바꾼 22페이지, `holdout-r1`은 다른 작품 10페이지다.
`production-final`이라는 실험 폴더는 **기각한 전체 문맥 후보**의 22페이지 결과다.
`final-c96`, `holdout-c96`은 효과음 강조 전 96픽셀 후보의 결과다.
다른 작품의 큰 `ド`·`ン` 효과음이 남는 것을 확대 검수에서 확인했고,
`including large bold black katakana lettering`을 추가해 두 글자를 제거했다.
일반 대사·컬러 제목·말풍선 경계를 포함한 11개 crop에 교차 검증했다.
이 지시문의 전체 페이지 비교는 `final-inclusive`, `holdout-inclusive`에 보존한다.
최종 semantic hint 조합의 결과는 `final-semantic`, `holdout-semantic`이다.
`report.json`에는 실행 시간, block 결과, source evidence receipt가 있으며
`pixel-parity.json`은 실제 엔진 호출 전후 RGB의 허용 영역 밖 변경을 검사한다.

source-glyph diagnostics는 evaluation-only이며 human gold, OCR 정확도 또는 출시
품질 점수가 아니다. seed에는 그림 선도 섞일 수 있다. `blocksErased` 역시
픽셀 변경/작업 완료 집계이며 글자 찌꺼기가 전혀 없다는 보증이 아니다.

## 연구 자료와 적용 범위

- [BFL FLUX.2 구현](https://github.com/black-forest-labs/flux2)과
  [stable-diffusion.cpp FLUX.2 문서](https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/flux2.md):
  distilled Klein 편집과 기본 sampler 설정을 확인했다. step 수 증가를 만능 해법으로
  간주하지 않고 실제 페이지에서 비교했다.
- [LanPaint 원저자 구현](https://github.com/scraed/LanPaint): inference 중 반복 보정을
  수행하는 다른 접근이다. 이번 native 경로에 통합하거나 품질을 검증한 것은 아니다.
- [Inference-time Trajectory Optimization for Structure-Preserving Manga Image Editing](https://arxiv.org/abs/2603.27790):
  원본 구조 보존을 위한 sampler 내부 보정을 제안한다. 별도의 구현/실제 데이터
  검증이 필요한 후속 후보이며 이번 수정에 적용했다고 주장하지 않는다.
- [Modeling Stroke Mask for End-to-End Text Erasing, WACV 2023](https://openaccess.thecvf.com/content/WACV2023/papers/Du_Modeling_Stroke_Mask_for_End-to-End_Text_Erasing_WACV_2023_paper.pdf):
  글자 획 마스크와 배경 보존의 관련성을 확인했다. 기존 production typography
  마스크 권위를 유지하며 무조건 큰 사각형을 지우는 정책을 추가하지 않았다.

## 재검증과 한계

최종 코드의 `npm run check`는 380.44초에 통과했다. 1,313개 test file,
10,130개 test 통과(기존 1 file / 9 test skipped), typecheck, lint, architecture,
build, page-artwork parity, image-protocol smoke를 포함한다. Rust native runner
4개와 shared image-processing 18개 test, 수정 Rust 파일의 rustfmt 검사도 통과했다.
로그는 `check-semantic-fixed.log`, `test-coverage-semantic.log`,
`cargo-semantic.log`, `shared-tests-c96.log`에 보존했다.

최종 조합은 최근 장 22페이지 / 118개 대상과 다른 작품 10페이지 / 69개 대상을
production 경로에서 처리했다. 전체 32페이지를 원본·기존 저장 결과와 직접 비교했다.
이 최종 173회 추론에서 검사한 허용 영역 밖 RGB 변경은 0이었다. 실제 hard
constraint가 있으면 그 픽셀을, 없으면 processing window + 32픽셀의 보수적
범위를 허용 영역으로 썼다. 따라서 이를 모든 원본 배경 픽셀의 동일성으로 확대하지 않는다.
선택된 대상의
작업 완료 수는 글자 전체의 완벽 삭제 점수로 해석하지 않는다.
`verification-inventory.json`의 보존된 실험·전체 페이지·재현성·smoke 기록 합계는
성공한 native 추론 1,127회다. 덮어쓴 중간 실행은 중복 집계하지 않는다.
`repeatability-semantic.json`은 컬러 제목과 말풍선 crop을 각각 두 번 생성한 PNG의
SHA-256 일치를 확인한다. `source-preservation.json`은 32개 원본 복사본의
hash 일치와 최근 장 메타데이터의 불변을 기록한다.

22페이지 실행은 모든 출력과 픽셀 검사를 마친 뒤 종료 단계에서 Windows process-tree
termination code 128이 한 번 발생했다. 해당 PID는 이미 존재하지 않았다. 이 종료
실패를 정상 exit로 바꾸거나 숨기지 않았다. 이후 다른 작품 10페이지 실행과 최신
빌드의 5페이지 `semantic-cleanup-smoke`는 추론·합성·dispose까지 exit 0으로 끝났다.
종료 helper 자체는 이번 품질 수정에서 변경하지 않았다.

최종 local bundle과 managed CUDA runner는 각각 8,434,176 bytes,
SHA-256 `46a01ecd24e11adee563bff2cf7d680cf45bed399c517bf0452d253ebb713eb9`다.

현재 PC의 local bundle과 managed CUDA runner가 같은 bytes인지 확인하고,
`prepareFluxInpaintingEngine` 정식 경로로 페이지 복사본을 처리한다. 다른 GPU,
CPU/Metal runner 또는 이미 게시된 다운로드 자산의 품질 검증을 대신하지 않는다.
원격 CPU/native release asset은 이 작업에서 게시하거나 교체하지 않는다.

대표 비교는 `before-after-semantic.png`, 말풍선/효과음 지시문 구분의 근거는
`bubble-sfx-routing.png`다. 기존 저장 결과와 비교할 때는 과거 검출/마스크의 차이도
있으므로 프롬프트의 단독 효과로 해석하지 않는다. 단일 변수 비교는 각 crop variant를 쓴다.

생성 모델의 그림 복원은 정답 이미지가 없는 추정이다. 검출되지 않은 글자,
hard constraint 바깥의 획, 글자와 그림이 붙은 부분은 여전히 검수 대상이다.
같은 결과에 무한히 재귀 인페인팅하지 않는다. 모든 비교는 원본 복사본에서 시작해
반복 생성에 따른 누적 손상을 피했다.

rollback은 이 문서에 기록한 수정 source와 local runner를 함께 되돌리고 기존
설치 경로로 runtime을 다시 준비하는 방식이다. 보관함을 지우거나 모델 cache 전체를
삭제할 필요가 없다.
