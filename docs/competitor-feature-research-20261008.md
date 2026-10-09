# AI 만화 번역 프로젝트 비교와 당근망가번역기 도입 후보

조사 기준일: 2026-10-08 KST. 로컬 비교 기준: v3.2.3 README와 작업 트리 HEAD `091fe85d`의 소스. 웹 가져오기 관련 진행 중 변경이 있는 작업 트리를 읽었으며, 앱 코드는 변경하지 않았다.

당근은 자동 번역·식자 기능의 폭이 이미 넓다. 다음 투자 효과가 큰 영역은 **AI 재실행을 되돌릴 수 있게 만들기, 검수와 수정에 드는 왕복 줄이기, 이전 번역을 재사용하기, 번역 결과를 바로 읽는 경험**이다. 독특한 중장기 후보로는 얼굴 기반 화자 연결, 근거 페이지를 보여주는 작품 검색, 사용자의 수정에서 배우는 제안 기능이 있다.

공개 저장소·공식 제품 문서에서 40개 비교 대상을 확인했다. 완성 번역기 외에 브라우저 확장, 리더, 보조 도구, 연구 및 개발 중 프로젝트를 포함한다. 모든 공개 프로젝트의 전수 목록이라는 뜻은 아니다. 외부 제품의 기능은 공개 문서 기준이며 직접 설치해 품질이나 속도를 측정한 결과가 아니다. 검색 결과만 남고 현재 본문을 열 수 없는 사례는 별도로 제외했다.

## 현재 앱에 이미 있는 기능

아래 기능은 신규 도입 아이디어로 계산하지 않았다.

| 영역            | 현재 확인한 기능                                                                   | 로컬 근거                                                                          |
| --------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 번역 파이프라인 | 단계별 실행·프리셋·기존 결과 보존·중단 후 재개                                     | [페이지 작업 계약](../src/shared/pageWorkflowTypes.ts), [README](../README.md)     |
| 문맥            | 작품별 용어집·인물 말투·규칙·페이지 장면 기억·인터넷 조사                          | [문맥 계약](../src/shared/workContextTypes.ts)                                     |
| 자동 검수       | 빈 번역, 원문과 같은 번역, 숫자 불일치, 부호 짝, 공백, 용어집 불일치               | [실제 검수 규칙](../src/main/pageWorkflow/pageWorkflowRuleExecution.ts)            |
| 검수 UI         | 현재 페이지에서 검수 대상 블록만 보기·검수 메모                                    | [PageBlockListPanel](../src/renderer/src/components/PageBlockListPanel.tsx)        |
| 편집            | 부분 서식·원근·곡선·워프·말풍선 모양 맞춤·다중 선택                                | [텍스트 계약](../src/shared/textTypes.ts), [README](../README.md)                  |
| 반복 작업       | 조건부 일괄 편집·변경 미리보기·YAML 규칙·서식 프리셋·블록 라이브러리               | [조건부 편집 계약](../src/shared/conditionalBatchRules.ts), [README](../README.md) |
| 이미지          | AOT·LaMa·Flux, 마스크·브러시·복원, 효과음 이미지와 재사용                          | [README](../README.md)                                                             |
| 입출력          | 이미지·압축·PDF·웹 가져오기, 이미지·PSD 출력, CSV/TSV 검수표, 작업 공유, 환경 백업 | [출력 계약](../src/shared/pageImageExportTypes.ts), [README](../README.md)         |
| 자동화          | MCP 조회·번역·검수·편집·출력, 결과 폴더 자동 동기화                                | [MCP 가이드](mcp-user-guide.md), [README](../README.md)                            |
| 폰트            | 원문 분위기에 대응하는 한글 폰트 자동 맞춤과 후속 제품 경로                        | [프로덕션 인계](font-matching-v2-production-handoff.md)                            |

특히 **자동 검수, AI 연결, 자연스러운 줄바꿈, 원문 비교, 백업, 효과음 번역이 없다**는 식의 제안은 잘못이다. 아래에서 ‘확장’은 기존 기능에 새 작업 흐름을 더한다는 뜻이다. ‘신규 후보’는 조사한 공개 UI·계약·소스 검색에서 전용 구현을 확인하지 못했다는 뜻이며, 저장소 전체의 부재를 형식적으로 증명한 것은 아니다.

## 도입 가치가 큰 10개

### 1 AI 처리 결과까지 되돌리는 작업 이력

**현재와 차이 — 확장.** 일반 편집 실행 취소와 재개 체크포인트는 있지만, README는 재번역 전체를 일반 실행 취소로 복구할 수 없다고 명시한다. 이 때문에 모델·설정을 바꿔 시험할 때 사용자가 작업 파일을 먼저 내보내야 한다.

[Koharu](https://koharu.rs/en/guides/review)는 파이프라인이 저장한 페이지별·단계별 결과도 실행 취소 단계로 취급한다. 다만 프로젝트를 다시 열면 과거 undo 스택은 복원하지 않는다. [Manga Reader](https://github.com/deckyfx/manga-reader)는 게시 이력과 rollback을 설명한다.

**당근에 적용할 형태:** 작업 센터에서 ‘이번 재번역 전으로’, ‘원문 제거만 되돌리기’를 제공한다. 나중에는 OCR·번역·지우기·식자 결과의 이름 붙인 버전을 비교한다. 기존 편집 이력·이미지 트랜잭션·revision 계약을 재사용하고, 이후 사용자가 고친 페이지는 충돌로 구분한다.

최소 범위는 한 페이지의 번역 전후 복원. 기대 효과는 재시도에 대한 부담 감소. 난도 **높음**: 텍스트뿐 아니라 이미지·마스크·기억·자동 출력 사이의 일관성이 필요하다.

### 2 말풍선에 맞는 짧은 번역 후보

**현재와 차이 — 신규 후보.** 자연스러운 줄바꿈과 글자 크기 맞춤은 이미 있다. 추가 가치는 글자를 계속 줄이는 대신 같은 뜻의 더 짧은 문장을 고르는 데 있다.

[BallonsTranslator Vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)는 선택 대사를 짧게 다시 쓰는 기능을 공개한다.

**당근에 적용할 형태:** 선택한 대사에 ‘짧게 / 자연스럽게 / 말투 유지’ 명령을 붙이고, 후보 2~3개를 실제 말풍선에 미리 렌더한다. 예컨대 긴 번역에 대해 ‘혹시 날 속인 거야?’와 ‘설마 날 속였어?’를 원문·앞뒤 대사와 함께 비교한다. 자동 확정하지 않고 의미 손실 여부를 사용자가 판단한다.

최소 범위는 선택 블록 한 개와 현재 API 프로필. 난도 **중간**. 시간 절약과 가독성 개선을 동시에 노릴 수 있는 우선 후보다.

### 3 여러 화의 문제를 모으는 검수함

**현재와 차이 — 확장.** 기본 자동 검수 6종과 현재 페이지의 검수 필터는 이미 있다. 부족한 후보 영역은 화·작품 전체를 가로지르는 단일 검수 흐름이다.

[manga-translation-pipeline](https://github.com/mshaiel/manga-translation-pipeline)은 페이지별 이상 항목·OCR 신뢰도·비용을 품질 보고서로 모은다. 이는 해당 프로젝트의 문서상 기능이며 성능 검증 결과로 인용하지 않는다.

**당근에 적용할 형태:** ‘이름 표기 8건 / 숫자 3건 / 번역 누락 2건’을 모으고, 항목을 누르면 해당 원문 crop·번역·페이지로 이동한다. 수정·보류·문제없음 처리 후 다음 문제로 넘어간다. 이후 화자 말투·잔여 원문·식자 가독성 점검을 별도 종류로 추가한다.

최소 범위는 이미 저장된 `pageWorkflow.findings`의 화 전체 집계. 난도 **중간**. OCR 점수·검출 점수·모델 자기평가를 한 개의 ‘정확도 %’로 섞지 않는다.

### 4 검수 완료 번역을 찾아주는 번역 메모리

**현재와 차이 — 신규 후보.** 스토리 메모리와 블록 라이브러리는 있다. 번역 메모리는 새 원문과 비슷한 과거 원문을 자동으로 찾아 사람이 확정한 번역을 제안하는 기능이다.

[ImageTrans](https://www.basiccat.org/imagetrans/)는 translation memory와 corpus concordance를 제공하며, [별도 설명](https://www.basiccat.org/real-time-screen-translator/)에서 OCR 오차를 허용하는 유사 일치를 다룬다.

**당근에 적용할 형태:** ‘3화 12페이지에서 같은 대사를 이렇게 번역했습니다’를 표시한다. 출처·화자·문맥·검수 여부를 함께 보여주고, 승인된 번역만 기본 후보에 넣는다. 짧은 감탄사처럼 문맥에 따라 달라지는 문장은 자동 치환하지 않는다.

최소 범위는 같은 작품의 원문 정규화 완전 일치. 이후 유사 검색을 추가한다. 난도 **중간**. 회상·반복 대사·기술명·정형 안내문에서 유용하다.

### 5 용어집을 고치면 영향받는 옛 번역도 제안

**현재와 차이 — 확장.** 용어집과 조건부 일괄 치환은 이미 있지만, 용어 편집에서 영향 분석까지 연결하는 전용 경험은 별도 후보다.

[BallonsTranslator Vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)는 용어의 번역 표기를 바꿀 때 기존 번역과 렌더 결과도 갱신한다고 설명한다.

**당근에 적용할 형태:** 이름 표기를 바꾸면 영향받는 블록을 모아 기존 일괄 편집 미리보기로 연다. 원문·별칭이 실제로 일치하는 항목을 우선하고, 수동 확정한 문장과 동명이인은 제외할 수 있게 한다. ‘용어 저장’만으로 과거 대사를 무조건 덮어쓰지 않는다.

최소 범위는 작품 내 완전 일치와 선택 적용. 난도 **중간**. 새 치환 엔진보다 기존 조건부 편집 계약의 재사용이 맞다.

### 6 원본과 번역을 같은 위치에서 비교하는 렌즈

**현재와 차이 — 확장.** `O`·`V` 표시 전환과 원본 불투명도 조절은 이미 있다. 추가 후보는 두 화면의 동기 확대·이동과 부분 비교 렌즈다.

[Saber 편집기](https://www.mashirosaber.top/use/pages.html)는 원본·번역의 동기 비교를, [FrankYomik](https://github.com/akitaonrails/FrankYomik)은 길게 눌러 번역을 들여다보는 렌즈를 제공한다.

**당근에 적용할 형태:** 수정 위치를 그대로 둔 채 누르는 동안만 작은 영역의 원본·지운 배경·최종 결과를 바꿔 본다. 넓은 창에서는 두 화면, 좁은 창에서는 렌즈를 쓴다. 수정 잔상·말풍선 테두리 손상·원문 누락을 확인할 때 편하다.

최소 범위는 캔버스의 같은 좌표를 비교하는 임시 렌즈. 난도 **낮음~중간**.

### 7 복제 도장과 톤 보정

**현재와 차이 — 신규 후보.** 칠하기·마스크·원본 복원 지우개는 있지만 다른 위치의 픽셀을 가져와 덮는 복제 도장은 별도다.

[Manga Translator UI](https://github.com/hgmzhn/manga-translator-ui/blob/main/README_EN.md)는 clone stamp를 제공한다. [ImageTrans의 톤 복원 비교](https://www.basiccat.org/remove-text-in-manga-preserving-screentone/)는 PatchMatch와 여러 인페인팅 경로를 비교한다.

**당근에 적용할 형태:** 원본/정리 배경에서 기준점을 잡고 작은 자국을 복제한다. 톤을 맞추기 위한 소스 위치 미리보기와 기존 이미지 실행 취소를 연결한다. 톤 주기까지 자동 추정하는 기능은 후속 연구로 둔다.

최소 범위는 고정 오프셋 복제 도장. 난도 **중간**. 작은 결함 때문에 이미지 모델을 재실행하는 횟수를 줄일 수 있다.

### 8 바로 읽을 수 있는 CBZ와 PDF 출력

**현재와 차이 — 확장.** 이미지·PSD·MCP ZIP은 있다. PDF를 가져오는 것과 완성본 PDF/CBZ를 출력하는 것은 다르다. 현재 `PageImageExportFormat`은 source/png/jpeg/webp다.

[Saber](https://github.com/MashiroSaber03/Saber-Translator)와 [Torii](https://toriitranslate.com/image)는 읽기용 묶음 출력을 제공한다.

**당근에 적용할 형태:** 결과물 출력에 CBZ와 PDF를 추가하고 작품명·화·페이지 순서·표지를 반영한다. 태블릿용과 보관용 품질 프리셋을 둔다. EPUB은 고정 레이아웃·뷰어 호환 검증이 더 필요하므로 별도 단계로 둔다.

최소 범위는 CBZ. 난도 **낮음~중간**. 실제 제품의 페이지 순서·렌더·충돌 정책을 그대로 사용한다.

### 9 편집기를 떠나지 않고 읽는 전용 뷰어

**현재와 차이 — 신규 후보.** 현재도 다른 잠기지 않은 페이지를 편집할 수 있고 패널을 접을 수 있다. 추가 가치는 단면·양면·연속 스크롤, 읽던 위치, 다음 화 이동에 특화된 모드다.

[Saber](https://github.com/MashiroSaber03/Saber-Translator)는 여러 읽기 모드를, [Comic Translate](https://github.com/ogkalu2/comic-translate)는 나머지 이미지가 번역되는 동안 처리된 이미지를 읽는 흐름을 설명한다.

**당근에 적용할 형태:** ‘번역 끝날 때까지 기다림’ 대신 첫 완성 페이지부터 읽는다. 현재 읽는 페이지와 다음 몇 장의 처리 우선순위를 높이는 기능은 후속으로 붙인다. 그 페이지의 문맥이 앞선 작업에 의존하면 순서를 무작정 바꾸지 않는다.

최소 범위는 완성 페이지의 연속 읽기와 마지막 위치 저장. 뷰어는 난도 **중간**, 작업 우선순위까지는 **높음**.

### 10 긴 웹툰을 자동 연결하고 안전한 경계에서 나누기

**현재와 차이 — 신규 후보.** 이미지 가져오기·페이지 이름/순서 편집과 별개의 기능이다.

[XianScan](https://github.com/ArbenApura/xianscan-rust)은 긴 스트립을 연결한 뒤 패널 사이 여백에서 재분할하는 흐름을 설명한다. [Torii](https://toriitranslate.com/)도 긴 스트립 처리를 제품 기능으로 제시한다. 두 제품의 속도·무손상 주장은 이번에 검증하지 않았다.

**당근에 적용할 형태:** 여러 조각을 하나의 가상 원고로 보고, 말풍선·글자가 경계에 걸리면 이웃 조각까지 읽는다. 처리용 타일은 내부 구현으로 숨기고 사용자는 연속 원고로 편집한다. 출력은 원래 조각 또는 연속 이미지 중 선택한다.

최소 범위는 가져오기 단계의 분할 미리보기와 경계 이동. 난도 **높음**. 원본 좌표·마스크·블록·출력 좌표의 가역 대응이 핵심이다.

## 전체 도입 후보 32개

난도는 현재 앱에 통합하는 상대적 추정이며 일정 약속이 아니다. ‘합성 제안’은 여러 사례에서 도출한 내 제안이고, 특정 경쟁 제품에 완성 기능이 있다는 뜻이 아니다.

| 번호 | 후보                                                | 현재 대비      | 참고 사례                                                                                                                                                | 난도와 도입 판단                                                     |
| ---: | --------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|    1 | AI 파이프라인 단계별 되돌리기·버전 비교             | 확장           | [Koharu](https://koharu.rs/en/guides/review)                                                                                                             | 높음. 편집기 사용 신뢰를 높이는 기반                                 |
|    2 | 말풍선에 실제로 맞춰 보는 짧은 번역 후보            | 신규 후보      | [Vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)                                                                                              | 중간. 빠르게 체감할 우선 후보                                        |
|    3 | 화·작품 전체 검수함과 다음 문제 이동                | 확장           | [품질 보고서 파이프라인](https://github.com/mshaiel/manga-translation-pipeline)                                                                          | 중간. 기존 6종 규칙부터 재사용                                       |
|    4 | 검수 완료 번역의 자동 검색·유사 일치                | 신규 후보      | [ImageTrans TM](https://www.basiccat.org/real-time-screen-translator/)                                                                                   | 중간. 작품 내 완전 일치부터                                          |
|    5 | 용어집 수정 영향 분석·과거 대사 선택 갱신           | 확장           | [Vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)                                                                                              | 중간. 기존 미리보기·충돌 검사 재사용                                 |
|    6 | 동기 비교·부분 비교 렌즈                            | 확장           | [FrankYomik](https://github.com/akitaonrails/FrankYomik), [Saber](https://www.mashirosaber.top/use/pages.html)                                           | 낮음~중간. 좁은 창에서도 유용                                        |
|    7 | 복제 도장·패턴 보정                                 | 신규 후보      | [MTUI](https://github.com/hgmzhn/manga-translator-ui/blob/main/README_EN.md)                                                                             | 중간. 작은 이미지 결함 수정에 집중                                   |
|    8 | 여러 블록 맞춤선·등간격 배치                        | 신규 후보      | [MTUI](https://github.com/hgmzhn/manga-translator-ui/blob/main/README_EN.md)                                                                             | 낮음~중간. 글자 정렬과 블록 위치 정렬을 구분                         |
|    9 | CBZ·PDF 읽기용 출력                                 | 확장           | [Saber](https://github.com/MashiroSaber03/Saber-Translator), [Torii](https://toriitranslate.com/image)                                                   | 낮음~중간. CBZ 먼저, EPUB은 후속                                     |
|   10 | 감시 폴더에 넣으면 가져오기·번역·출력               | 신규 후보      | [ImageTrans Hot Folder](https://www.basiccat.org/batch-ocr-and-translate-image-and-PDF/)                                                                 | 중간. 현재의 결과물 자동 저장은 출력 방향 기능                       |
|   11 | 양면·연속 스크롤·이어 읽기 전용 뷰어                | 신규 후보      | [Saber](https://github.com/MashiroSaber03/Saber-Translator), [ComicReadScript](https://github.com/hymbz/ComicReadScript)                                 | 중간. 일반 독자 대상 가치 큼                                         |
|   12 | 읽는 위치 기준 선처리·다음 페이지 미리 준비         | 확장           | [FrankYomik](https://github.com/akitaonrails/FrankYomik), [확장 번역기](https://github.com/lehuyqq/Manga-Translator-Extension)                           | 높음. 누적 문맥 의존을 지켜야 함                                     |
|   13 | 브라우저 현 위치 번역·당근으로 보내기               | 확장           | [Saber 확장](https://github.com/MashiroSaber03/Saber-Translator), [LMT](https://github.com/mrdhnto/libre-manga-translator)                               | 높음. 기존 웹 가져오기는 활용, 페이지 위 표시가 신규                 |
|   14 | PC가 번역하고 휴대폰·Mihon에서 읽기                 | 신규 후보      | [XianScan](https://github.com/ArbenApura/xianscan-rust), [Yakuyomi](https://github.com/joyeli/Yakuyomi)                                                  | 높음. 먼저 읽기 전용 동반 뷰어                                       |
|   15 | 웹툰 가상 연결·여백 분할·경계 OCR                   | 신규 후보      | [XianScan](https://github.com/ArbenApura/xianscan-rust)                                                                                                  | 높음. 웹툰 비중이 크면 우선순위 상승                                 |
|   16 | OCR 엔진 불일치 부분만 비교·선택                    | 확장           | [MTUI 혼합 OCR](https://github.com/hgmzhn/manga-translator-ui/blob/main/doc/en/FEATURES.md), [Saber](https://github.com/MashiroSaber03/Saber-Translator) | 중간~높음. 현재의 엔진 비교에 블록 단위 선택을 추가                  |
|   17 | OCR 입력만 확대·대비 보정하고 원고는 유지           | 신규 후보      | [MangaTranslator](https://github.com/meangrinch/MangaTranslator), [MIT](https://github.com/zyddnys/manga-image-translator)                               | 중간. 작은 글자에서 검증하고 생성된 획 오인식 확인                   |
|   18 | 같은 페이지를 여러 모델·프롬프트로 비교             | 신규 후보      | [Vibe Translation Benchmark](https://github.com/CoSciBlog/BallonsTranslator-vibe)                                                                        | 중간. 본문에 덮어쓰지 않는 비교 세션                                 |
|   19 | 화자·호칭·대명사 중심 AI 교정 제안                  | 확장           | [Saber AI 교정](https://www.mashirosaber.top/use/ai-proofreading.html), [Vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)                      | 중간. 현재 MCP 검수와 구분되는 앱 내 후보 승인 흐름                  |
|   20 | 장 전체 사전 읽기 후 번역·다음 장면 참고            | 확장           | [Saber 고품질 모드](https://www.mashirosaber.top/use/pages.html), [Vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)                            | 높음. 현재 누적 문맥에 미래 문맥 범위와 버전을 추가                  |
|   21 | 지운 배경에 남은 글자만 재검출                      | 확장           | [Vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)                                                                                              | 중간. 원문 유지로 지정한 효과음 등은 검사에서 구분                   |
|   22 | 단색·망점·그림 영역별 지우기 경로 추천              | 확장·합성 제안 | [LMT](https://github.com/mrdhnto/libre-manga-translator), [ImageTrans 비교](https://www.basiccat.org/remove-text-in-manga-preserving-screentone/)        | 높음. 비용보다 보존 품질을 우선 검증                                 |
|   23 | 얼굴 견본으로 인물 묶기·대사 화자 연결              | 신규 연구 후보 | [Magi](https://github.com/ragavsachdeva/magi)                                                                                                            | 높음. 연구 전용 모델의 제품 사용 권한은 별도 해결                    |
|   24 | ‘이 별명 처음 나온 곳’ 같은 의미 검색과 근거 페이지 | 신규 후보      | [Saber Manga Insight](https://www.mashirosaber.top/use/manga-insight.html)                                                                               | 높음. 현재 텍스트 검색·장면 기억을 확장                              |
|   25 | 원문 선택·사전·후리가나·문장 학습                   | 신규 후보      | [mokuro](https://github.com/kha-white/mokuro), [Yomikomi](https://github.com/sieugene/yomikomi)                                                          | 중간~높음. 번역과 일본어 학습을 오갈 때 유용                         |
|   26 | 패널 따라 읽기·대사 하이라이트·음성 읽기            | 합성 제안      | [Magi](https://github.com/ragavsachdeva/magi)의 읽기 순서·화자 정보에서 확장                                                                             | 높음. 접근성·학습 방향, 음성 복제 없이 시작                          |
|   27 | 수동 수정에서 말투·용어·서식 규칙을 제안            | 합성 제안      | [ImageTrans TM](https://www.basiccat.org/imagetrans/)와 당근 기존 규칙·프리셋의 결합                                                                     | 높음. 무조건 학습하지 말고 반복 수정의 규칙 후보 승인부터            |
|   28 | 기존 저화질 번역본의 문구를 고화질 원본에 이식      | 신규 후보      | [MTUI Replace Translation](https://github.com/hgmzhn/manga-translator-ui/blob/main/doc/en/USAGE.md)                                                      | 높음. 페이지·영역 대응을 검토하고 누락은 표시                        |
|   29 | Word·XLIFF·LabelPlus 등 외부 검수 도구 교환         | 확장           | [BallonsTranslator](https://github.com/dmMaze/BallonsTranslator), [ImageTrans](https://www.basiccat.org/imagetrans/)                                     | 중간. 이미 있는 CSV/TSV·PSD와 중복 평가 필요                         |
|   30 | 루비·세로 글 속 가로 숫자·문장부호 광학 정렬        | 확장           | [MTU-JSON-GUI](https://github.com/charlespfan/mtu-json-gui), [MTUI](https://github.com/hgmzhn/manga-translator-ui/blob/main/README_EN.md)                | 중간~높음. 원문 후리가나 검출과 루비 식자는 서로 다름                |
|   31 | 작업별 토큰·추정 비용·예산 상한·요청 수 표시        | 확장           | [Yakuyomi 통계](https://github.com/joyeli/Yakuyomi), [품질 보고서](https://github.com/mshaiel/manga-translation-pipeline)                                | 중간. 상한에서 멈추는 정책은 합성 제안, 요금 모르면 추정 불가로 표시 |
|   32 | 검수 요청·담당자·초안과 확정본 구분                 | 확장           | [Mantra](https://mantra.co.jp/en), [Manga Reader](https://github.com/deckyfx/manga-reader)                                                               | 높음. `.mgtshare`와 검수표 위에 승인 절차부터                        |

## 독특한 후보의 도입 방향

**얼굴을 한 번 지정하면 화자 후보가 따라오는 인물 사전.** 현재 `CharacterProfile`은 이름·별칭·화법·메모 중심이다. 얼굴 crop·등장 페이지·대사 연결을 더하면 이름을 부르지 않는 장면에서도 말투 일관성을 도울 수 있다. 사용자는 얼굴 묶음에서 ‘이 둘은 같은 인물’을 수정한다. 옆모습·변장·유년기·쌍둥이·화면 밖 대사가 중요한 실패 사례다. [Magi](https://github.com/ragavsachdeva/magi)는 이런 시각적 연결의 직접적인 연구 사례지만 제공 모델·데이터는 academic research only라고 명시한다.

**작품을 기억하는 근거 검색.** ‘이 기술명 처음 등장한 화’, ‘이 인물이 존댓말을 쓰던 상대’, ‘예전 회상 장면’을 검색해 정확한 페이지·블록을 열도록 한다. 외부 인터넷 조사와 달리 사용자 보관함 안의 근거를 찾는다. 요약만 답하면 검수가 어려우므로 근거가 없는 답은 구분한다. [Saber Manga Insight](https://www.mashirosaber.top/use/manga-insight.html)의 RAG·다층 요약이 참고 사례다.

**고화질 원본으로 번역 이식.** 예전에 완성한 번역 이미지와 새 원고를 정렬해 대사·영역을 이전한다. 단순 OCR 재실행보다 판본 간 편집 차이와 페이지 누락 대응이 핵심이다. 처음에는 사람이 페이지를 짝지은 뒤 블록 후보를 확인하는 도구가 적절하다. [MTUI 사용 가이드](https://github.com/hgmzhn/manga-translator-ui/blob/main/doc/en/USAGE.md)의 Replace Translation이 출발점이다.

**개인 교정 습관을 배우는 제안.** 같은 인물의 어미를 계속 고치거나 특정 원문 스타일의 폰트를 반복 수정하면 ‘이 작품에서 규칙으로 저장할까요’를 제안한다. 기존 번역 규칙·조건부 편집·서식 프리셋으로 저장 가능한 패턴부터 시작한다. 모델 재훈련은 별도 문제다. 폰트 후속 연구의 기존 평가 데이터나 수동 감사를 human gold로 재해석해서는 안 된다. [현재 데이터 권위](font-matching-v2-production-handoff.md)를 따른다.

## 비교 대상 40개

제품 README·공식 문서에서 확인한 특성과 당근에 대한 참고 가치를 짧게 정리했다. 같은 계열의 fork는 기능 차이가 있는 경우 별도 대상으로 보되, 서로 독립적인 기술 성과로 세지 않았다.

| 번호 | 프로젝트와 출처                                                                                           | 형태                   | 참고할 부분과 판단                                                                     |
| ---: | --------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
|    1 | [dmMaze/BallonsTranslator](https://github.com/dmMaze/BallonsTranslator)                                   | 데스크톱 편집기        | Word 교환, 풍부한 편집. 핵심 자동 처리 대부분 당근과 중복                              |
|    2 | [zyddnys/manga-image-translator](https://github.com/zyddnys/manga-image-translator)                       | 엔진·CLI·웹            | 업스케일·다양한 처리 모듈. 여러 파생 프로젝트의 기반                                   |
|    3 | [hgmzhn/manga-translator-ui](https://github.com/hgmzhn/manga-translator-ui/blob/main/README_EN.md)        | MIT 계열 편집기        | 복제 도장·정렬/간격·루비·혼합 OCR·번역 이식                                            |
|    4 | [charlespfan/mtu-json-gui](https://github.com/charlespfan/mtu-json-gui)                                   | 식자 보조 편집기       | 문장부호 광학 정렬·OCR 기반 행간·세로 숫자 배치                                        |
|    5 | [koharu-rs/koharu](https://github.com/koharu-rs/koharu)                                                   | 로컬 데스크톱 편집기   | AI 단계별 undo, 레이어 구조. 이전 mayocream 주소에서 이동                              |
|    6 | [ogkalu2/comic-translate](https://github.com/ogkalu2/comic-translate)                                     | 데스크톱·확장          | 여러 만화권 언어·형식, 처리 중 읽기                                                    |
|    7 | [MashiroSaber03/Saber-Translator](https://github.com/MashiroSaber03/Saber-Translator)                     | 통합 번역·리더·분석    | 읽기 모드·브라우저 연결·작품 의미 검색이 주요 차이                                     |
|    8 | [CoSciBlog/BallonsTranslator-vibe](https://github.com/CoSciBlog/BallonsTranslator-vibe)                   | Ballons fork           | 짧게 다시 쓰기·모델 비교·용어 수정 전파·잔여 글자 재검출                               |
|    9 | [meangrinch/MangaTranslator](https://github.com/meangrinch/MangaTranslator)                               | 웹·CLI                 | 말풍선 밖 텍스트와 확대 처리. Flux 자체는 당근에 이미 있음                             |
|   10 | [ArbenApura/xianscan-rust](https://github.com/ArbenApura/xianscan-rust)                                   | 서버·리더 연동         | 웹툰 여백 재분할·Mihon 스트리밍                                                        |
|   11 | [akitaonrails/FrankYomik](https://github.com/akitaonrails/FrankYomik)                                     | 서버·확장·모바일       | 길게 눌러 번역/후리가나 렌즈·미리 처리                                                 |
|   12 | [kha-white/mokuro](https://github.com/kha-white/mokuro)                                                   | OCR·독서 보조          | 선택 가능한 원문·사전 학습·휴대 가능한 읽기 데이터                                     |
|   13 | [hymbz/ComicReadScript](https://github.com/hymbz/ComicReadScript)                                         | 브라우저 리더 스크립트 | 스크롤·병렬 스크롤·번역 연결. 독서 UX 참고                                             |
|   14 | [joyeli/Yakuyomi](https://github.com/joyeli/Yakuyomi)                                                     | Mihon 계열 Android 앱  | 읽으며 번역·다운로드 중 번역·전자잉크 모드·사용 통계                                   |
|   15 | [sieugene/yomikomi](https://github.com/sieugene/yomikomi)                                                 | 브라우저 학습 리더     | OCR·사전·토큰 분석·로컬 번역·Anki 자료 보기                                            |
|   16 | [deckyfx/manga-reader](https://github.com/deckyfx/manga-reader)                                           | 서버·Studio·리더       | 초안/게시본 분리·rollback·역할별 접근                                                  |
|   17 | [lehuyqq/Manga-Translator-Extension](https://github.com/lehuyqq/Manga-Translator-Extension)               | 확장·로컬 서버         | 스크롤 자동 번역·다음 이미지 준비·선택 가져오기                                        |
|   18 | [DragonMeow1012/DragonMeow-MangaTranslator](https://github.com/DragonMeow1012/DragonMeow-MangaTranslator) | 웹 편집기·확장         | 원문 잠깐 보기·페이지 안 번역·초기 번역 상태 복원                                      |
|   19 | [mrdhnto/libre-manga-translator](https://github.com/mrdhnto/libre-manga-translator)                       | 브라우저 확장          | WebGPU/자체 서버/클라우드 선택·문자 종류 필터·적응형 지우기                            |
|   20 | [Unheat/Kites](https://github.com/Unheat/Kites)                                                           | 브라우저 확장          | 가벼운 진입·스크롤 자동 번역·원본/정리본/최종본 비교                                   |
|   21 | [drawhisper-org/komakun](https://github.com/drawhisper-org/komakun)                                       | 브라우저 번역 IDE      | 설치 없이 OCR·지우기·식자. 팀 지향 설명만으로 동시 편집까지 있다고 단정하지 않음       |
|   22 | [Shirochi-stack/Glossarion](https://github.com/Shirochi-stack/Glossarion)                                 | 종합 번역 스위트       | 중복·반복·이름 일관성 검사와 보고서. 소설용 검사 전부를 만화 기능으로 간주하지 않음    |
|   23 | [mshaiel/manga-translation-pipeline](https://github.com/mshaiel/manga-translation-pipeline)               | 연구 성격 파이프라인   | 화자 연결·품질/비용 보고서. README의 우월성 주장은 채택하지 않음                       |
|   24 | [daominhwysi/manga-translator](https://github.com/daominhwysi/manga-translator)                           | 파이프라인             | OCR crop 묶음 전송·말풍선 다각형에 맞는 확장. 실제 비용 절감률 미검증                  |
|   25 | [columncat/AI-Manga-Translator-with-GUI](https://github.com/columncat/AI-Manga-Translator-with-GUI)       | 한국어 데스크톱        | 단계별 탭·작업 이력 도크. 기본 기능은 상당 부분 중복                                   |
|   26 | [Detopall/manga-translator](https://github.com/Detopall/manga-translator)                                 | 웹 앱                  | 모바일 대응·이미지 탐색·ZIP 출력. 낮은 진입 장벽 참고                                  |
|   27 | [kisakibobo/TsengScans](https://github.com/kisakibobo/TsengScans-AI-Manga-Translation-and-Writing-Tool)   | 웹 보조 도구           | 말풍선 crop 중심 흐름. 당근의 영역 번역과 중복                                         |
|   28 | [P4ST4S/AutoScanlate-AI](https://github.com/P4ST4S/AutoScanlate-AI)                                       | 로컬 서버 파이프라인   | 실시간 단계 진행·로컬 처리. 공개 처리량 수치는 비교 근거로 사용하지 않음               |
|   29 | [marco0antonio0/translate-manga-br](https://github.com/marco0antonio0/translate-manga-br)                 | 웹·확장                | 편집 가능한 리더·읽기 링크·다중 사용자·전체 작업 큐                                    |
|   30 | [cameronkinsella/manga-translator](https://github.com/cameronkinsella/manga-translator)                   | Go CLI·GUI             | OCR·번역의 단순 실행 도구. 큰 신규 차별점은 적음                                       |
|   31 | [wiryaimd/manga-translator](https://github.com/wiryaimd/manga-translator)                                 | Android                | ML Kit 기반 모바일 OCR·번역·합성                                                       |
|   32 | [DCY1117/MangaQuick](https://github.com/DCY1117/MangaQuick)                                               | 로컬·Colab             | 잘못 잡은 검출 상자를 간단히 제외. 현재 기능과 중복                                    |
|   33 | [ttop32/JMTrans](https://github.com/ttop32/JMTrans)                                                       | 한국어 자동 번역 도구  | URL 입력에서 ZIP까지의 단순 흐름. 오래된 구성 그대로 도입할 후보는 아님                |
|   34 | [szmc-team/SickZil-Machine](https://github.com/szmc-team/SickZil-Machine)                                 | 식자·제거 보조 계열    | 현재 루트 문서가 매우 짧음. 존재 확인 수준이며 상세 기능 판단에서 제외                 |
|   35 | [Torii](https://toriitranslate.com/)                                                                      | 상용 확장·웹           | 긴 스트립·읽으며 번역·편집·다양한 출력                                                 |
|   36 | [ImageTrans](https://www.basiccat.org/imagetrans/)                                                        | 상용 CAT 도구          | 번역 메모리·감시 폴더·외부 교환·화면 번역이 주요 차이                                  |
|   37 | [Scan Translator](https://scan-translator.com/updates)                                                    | 상용 확장·웹           | 번역 링크 공유·검출 재실행 없는 번역 재시도·누락 영역 보완                             |
|   38 | [Mantra Engine](https://mantra.co.jp/en)                                                                  | 출판용 플랫폼          | 번역자·디자이너의 브라우저 편집. 세부 권한/동시성 구현은 공개 설명만으로 판단하지 않음 |
|   39 | [Magi](https://github.com/ragavsachdeva/magi)                                                             | 연구 모델              | 패널·인물·텍스트 검출, 인물 묶기, 화자와 읽기 순서. academic research only             |
|   40 | [VoileLabs/cotrans](https://github.com/VoileLabs/cotrans)                                                 | 개발 중 협업 플랫폼    | README가 work in progress로 명시. 완성된 협업 제품의 증거로 사용하지 않음              |

### 발견했지만 상세 비교에서 제외한 사례

- [linh4264/manga-translator-studio](https://github.com/linh4264/manga-translator-studio): 검색 색인에는 일관성 검사 등의 설명이 남아 있었지만 저장소 README 재접근은 404였다. 현재 사용 가능한 구현으로 추천하지 않았다.
- [Ichigo](https://ichigo.moe/): 서비스와 검색 색인은 확인했으나 본문을 충분히 읽지 못해 구체적인 기능 비교 근거로 쓰지 않았다.
- [izure1/manga-trans](https://github.com/izure1/manga-trans): GitHub 토픽에서 발견했으나 README를 확보하지 못해 상세 비교에서 제외했다.
- [mrdhnto/local-manga-translator](https://github.com/mrdhnto/local-manga-translator): README가 보관된 PoC이며 후속 LMT로 이동했다고 명시하므로 후속 프로젝트에 통합했다.
- MIT/Comic Translate 계열의 기본 기능만 반복한 fork는 독립적인 도입 아이디어가 없으면 주요 목록을 늘리는 데 사용하지 않았다.

## 우선순위가 낮은 방향

| 방향                                  | 사례                                                                                                                     | 판단                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 전체 페이지 AI 컬러화                 | [Torii](https://toriitranslate.com/), [MTUI](https://github.com/hgmzhn/manga-translator-ui/blob/main/doc/en/FEATURES.md) | 흥미롭지만 번역·검수 시간 절약과 직접 연결되는 정도가 낮음                              |
| 만화 후속 이야기 생성·인물 채팅       | [Saber](https://www.mashirosaber.top/use/pages.html)                                                                     | 독특하나 창작 제품으로 범위가 커짐. 작품 근거 검색을 먼저 도입                          |
| 기능 수를 늘리기 위한 번역 엔진 추가  | 여러 프로젝트                                                                                                            | 현재 API 프로필을 활용하고, 실제 품질 비교가 되는 A/B 기능을 우선                       |
| 플러그인 마켓을 먼저 만들기           | [Saber](https://github.com/MashiroSaber03/Saber-Translator)                                                              | 이미 있는 MCP·규칙 파일·프리셋으로 해결하지 못하는 수요가 확인된 후                     |
| 브라우저 안에서 모든 모델을 새로 구현 | [Kites](https://github.com/Unheat/Kites), [LMT](https://github.com/mrdhnto/libre-manga-translator)                       | 당근 로컬 런타임이 이미 있으므로 먼저 얇은 브라우저 연결을 만드는 편이 통합 부담이 작음 |

## 구현 순서를 고른다면

**현재 편집기의 체감 개선:** 비교 렌즈 → 짧은 번역 후보 → 화 전체 검수함 → 용어 변경 영향 미리보기. AI 작업 복원은 난도가 높지만 이 흐름과 함께 설계할 기반이다.

**일반 독자까지 넓히기:** CBZ 출력 → 전용 읽기 모드 → 브라우저에서 당근으로 보내기 → 읽는 위치 선처리 → 휴대폰 읽기. 처음부터 모바일 편집기 전체를 복제할 필요는 없다.

**장편 번역의 차별화:** 검수 완료 번역 메모리 → 인물별 교정 제안 → 근거 페이지 검색 → 얼굴 기반 화자 연결. ‘개인 교정 학습’은 그 뒤에 실제 수정 데이터의 품질을 확인하며 도입한다.

각 후보의 성공은 기능 개수보다 실제 작업으로 측정해야 한다. 같은 원고에서 첫 읽기까지 걸린 시간, 한 화의 검수 완료 시간, 수동 재입력 횟수, 되돌리기 성공 여부, 승인하지 않은 변경 발생 여부를 비교한다. 연구 모델이나 새 렌더러로 기존 결과를 바꾸는 경우에는 저장소의 characterization/parity·실제 production UI QA 원칙을 그대로 적용한다.
