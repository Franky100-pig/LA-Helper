// 新手引导数据：每个运算一个「能体现它特点」的示例矩阵，外加 3 个一键上手场景。
//
// 为什么单独放一个文件：示例是纯数据，既要给 app.js 用，也要给 tools/test_examples.js
// 逐条校验（矩阵必须存在、形状自洽、每个运算都有例子）。放进 app.js 就没法在不启动
// 页面的情况下检查了。
//
// 载荷约定：
//   ops[<op>]      = { A: [[…]], B?: [[…]], left?, right? }
//                    A 必有；只有需要第二个操作数的运算才有 B（见 app.js 的 OPS_NEED_B）。
//   starters[]     = 一键上手场景，除矩阵外还指定 op / 操作数 / det 算法。
//   articles[<op>]= 算完这个运算后推荐哪篇讲义（对应 notes.js 的 id），没有就整条不显示。
//
// 矩阵里的值一律写成字符串（网格里存的就是字符串），保持和 state.lib 的形状一致。
(function () {
  "use strict";

  // 17 个运算，逐个给一个「有教学意义」的例子，而不是随便填几个数。
  const ops = {
    // 非方阵相乘：顺便说明为什么 A×B 和 B×A 不是一个东西。
    multiply: {
      A: [["1", "2", "3"], ["4", "5", "6"]],
      B: [["7", "8"], ["9", "10"], ["11", "12"]],
      left: "A", right: "B",
    },
    add: {
      A: [["1", "2"], ["3", "4"]],
      B: [["5", "6"], ["7", "8"]],
      left: "A", right: "B",
    },
    sub: {
      A: [["5", "7"], ["9", "11"]],
      B: [["2", "3"], ["4", "5"]],
      left: "A", right: "B",
    },
    // 2×3 转置成 3×2：让「行列互换」这件事一眼可见。
    transpose: {
      A: [["1", "2", "3"], ["4", "5", "6"]],
    },
    // 标量乘：k 写在 B 的左上角（界面就是这么规定的）。
    scalar: {
      A: [["1", "2"], ["3", "4"]],
      B: [["3"]],
      left: "A", right: "B",
    },
    // 逆特意选一个答案是分数的矩阵 —— 正好证明「1/2 不会变成 0.5」这个卖点。
    inverse: {
      A: [["1", "1"], ["1", "-1"]],
    },
    // 左逆需要满列秩（行数 > 列数）。
    left_inverse: {
      A: [["1", "0"], ["0", "1"], ["1", "1"]],
    },
    // 右逆需要满行秩（行数 < 列数）。
    right_inverse: {
      A: [["1", "0", "1"], ["0", "1", "1"]],
    },
    // 伪逆：故意用一个奇异矩阵（没有逆），突出「伪逆哪儿都存在」。
    pseudo_inverse: {
      A: [["1", "2"], ["2", "4"]],
    },
    // LU：行化简比按顺序消元更好（第一行主元 1 < 第二行 4），能看出选主元发生了。
    lu: {
      A: [["1", "2"], ["4", "3"]],
    },
    // 解方程组，答案凑成整数 x=1, y=3。
    solve: {
      A: [["2", "1"], ["1", "3"]],
      B: [["5"], ["10"]],
      left: "A", right: "B",
    },
    // REF：第三行会被消成全零，一眼看出这三行线性相关。
    ref: {
      A: [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]],
    },
    // 行列式：矩阵里有 0，余子式展开能挑到最省事的那一行/列。
    det: {
      A: [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]],
    },
    // 余子式矩阵 / 伴随矩阵：跟 det 用同一个矩阵，两篇讲义正好互相印证。
    cofactor_matrix: {
      A: [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]],
    },
    // 秩：秩为 2，不是 3。
    rank: {
      A: [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]],
    },
    // 特征值：λ=3 与 λ=1，特征向量是 (1,1) 与 (1,−1)，对称好看。
    eigen: {
      A: [["2", "1"], ["1", "2"]],
    },
  };

  // 三个「第一次来，点一下就有东西看」的场景。每个都把 op 和矩阵一起设好。
  const starters = [
    {
      id: "startSingular",
      op: "inverse",
      A: [["1", "2"], ["2", "4"]],
      // 这题没有逆 —— 正好撞上「det=0 就不可逆」，结果区会直接告诉你原因。
      pick: "singular",
    },
    {
      id: "startCofactor",
      op: "det",
      detMethod: "cofactor",
      A: [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]],
      pick: "cofactor",
    },
    {
      id: "startSolve",
      op: "solve",
      A: [["2", "1"], ["1", "3"]],
      B: [["5"], ["10"]],
      left: "A", right: "B",
      pick: "solve",
    },
  ];

  // 运算 → 讲义 id（notes.js 里的 id）。留空表示这一运算不挂讲义。
  // 标题在这里重复存一份，tools/test_notes.js 会校验它和 notes.js 完全一致（防漂移）。
  const articles = {
    multiply: { id: "matmul", title: { zh: "矩阵乘法为什么这么怪", en: "Why matrix multiplication looks so weird" } },
    inverse: { id: "singular", title: { zh: "det = 0 为什么就没有逆", en: "Why det = 0 means there is no inverse" } },
    left_inverse: { id: "rank", title: { zh: "秩到底在说什么", en: "What rank is really saying" } },
    right_inverse: { id: "rank", title: { zh: "秩到底在说什么", en: "What rank is really saying" } },
    pseudo_inverse: { id: "rank", title: { zh: "秩到底在说什么", en: "What rank is really saying" } },
    lu: { id: "row-reduction", title: { zh: "为什么行列式能用行变换来算", en: "Why row operations can compute a determinant" } },
    solve: { id: "row-reduction", title: { zh: "为什么行列式能用行变换来算", en: "Why row operations can compute a determinant" } },
    ref: { id: "row-reduction", title: { zh: "为什么行列式能用行变换来算", en: "Why row operations can compute a determinant" } },
    // det 不在这里：它按用户选的算法分别挂 row-reduction / cofactor，见文件末尾 detArticles。
    cofactor_matrix: { id: "adjugate", title: { zh: "伴随矩阵与求逆公式", en: "The adjugate and the inverse formula" } },
    rank: { id: "rank", title: { zh: "秩到底在说什么", en: "What rank is really saying" } },
    eigen: { id: "eigen", title: { zh: "特征值 / 特征向量的几何意义", en: "The geometry of eigenvalues and eigenvectors" } },
  };

  // 行列式有两种算法，推荐的讲义不一样：行变换法对应 row-reduction，余子式展开对应 cofactor。
  const detArticles = {
    row_reduction: {
      id: "row-reduction",
      title: { zh: "为什么行列式能用行变换来算", en: "Why row operations can compute a determinant" },
    },
    cofactor: {
      id: "cofactor",
      title: { zh: "代数余子式到底在干什么", en: "What cofactors are actually doing" },
    },
  };

  window.LA_EXAMPLES = { ops, starters, articles, detArticles };
})();
