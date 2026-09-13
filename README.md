# 노란 백룸 수학 탈출

Three.js로 만든 3인칭 미로 탈출 + 수학 퀴즈 게임입니다. 발디의 수학교실에서 영감을 받았습니다.

학교 복도(순환 구조라 여러 경로로 다닐 수 있음)를 따라 교실들이 붙어 있고,
교실 안의 책을 탭하면 수학 문제가 나옵니다. 정답을 맞히면 열쇠를 얻고,
틀리면 복도를 순찰하는 선생님(발디)의 속도가 영구히 빨라집니다.
열쇠를 모두 모아 탈출문에 도달하면 승리, 선생님에게 붙잡히면 게임 오버입니다.

## 실행 방법

정적 파일만 사용하므로 별도 빌드가 필요 없습니다. 다만 브라우저 보안 정책상
`index.html`을 더블클릭해서 바로 열면(`file://`) 상대 경로로 불러오는
`css/style.css`, `js/main.js`가 제대로 로드되지 않을 수 있으니, 로컬 정적
서버로 열어서 확인하는 것을 권장합니다.

```bash
npx serve .
# 또는
python -m http.server 8080
```

그 다음 브라우저에서 `http://localhost:<port>` 로 접속하면 됩니다.
GitHub Pages 등 실제 웹 호스팅에 올리면 이 문제는 발생하지 않습니다.

## 조작

- 왼쪽 조이스틱 (또는 방향키/WASD): 이동
- 화면 오른쪽 드래그: 시점 회전
- 오른쪽 하단 "달리기" 버튼 (또는 Shift 키): 스태미나를 소모하며 스프린트
- 책 탭(클릭): 가까이 있으면 수학 문제 출제

## 프로젝트 구조

```
index.html          진입점, UI 마크업
css/style.css        스타일
js/main.js           게임 로직 전체 (맵 생성, 이동, AI, 퀴즈, 상태관리)
assets/models/       (선택) 실제 3D 모델(.glb)을 넣는 곳
```

## 나중에 실제 3D 에셋으로 교체하기

지금은 캐릭터/책이 전부 기본 도형(원기둥·구·박스)으로 그려지는 플레이스홀더입니다.
`js/main.js` 상단의 `ASSET_PATHS`, `ASSET_TUNING` 값이 가리키는 경로에 맞춰
`.glb` 파일을 넣으면, 게임이 자동으로 그 모델을 불러와 플레이스홀더 대신 사용합니다.
코드를 더 고칠 필요는 없습니다.

| 대상 | 넣을 파일 경로 |
|---|---|
| 주인공 | `assets/models/player.glb` |
| 발디(선생님) | `assets/models/baldi.glb` |
| 책 | `assets/models/book.glb` |

참고 사항:
- glTF Binary(.glb) 형식 하나만 지원합니다 (별도 텍스처/바이너리 분리 없이 하나의 파일로 내보내주세요).
- 모델의 정면은 +Z 방향, 바닥(발밑)은 로컬 원점(y=0)에 맞춰서 내보내면 별도 오프셋 없이 바로 맞습니다.
- 스케일이나 회전이 안 맞으면 `js/main.js`의 `ASSET_TUNING.player/baldi/book`에서
  `scale`, `rotationY`, `yOffset` 값을 조절하면 됩니다.
- 모델을 넣지 않아도 게임은 정상 동작합니다(플레이스홀더 도형으로 대체). 콘솔에 뜨는
  404 에러는 아직 파일이 없다는 뜻이라 무시해도 됩니다.
- 걷기/달리기 애니메이션(AnimationMixer 연동)은 아직 붙어있지 않습니다. 모델에
  애니메이션 클립이 있다면 별도 작업이 필요합니다.

## 난이도 조절

`js/main.js` 맨 위 `CONFIG` 섹션의 상수만 바꾸면 됩니다.

- `interiorSize`, `roomSlotCount`, `booksCount`, `keysNeeded`: 맵 크기와 열쇠 개수
- `baldiSpeed`(초기값), `baldiSpeedStep`, `baldiSpeedCap`: 선생님 속도/오답 페널티
- `walkSpeed`, `sprintMultiplier`, `staminaMax`, `staminaDrainPerSec`, `staminaRegenPerSec`: 달리기 밸런스
