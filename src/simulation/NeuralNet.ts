import { gaussianRandom } from '../utils/mathUtils';

/**
 * 剑心 —— 极简前馈神经网络 (纯函数，无外部依赖，便于突变与序列化)。
 * 结构：输入层 -> tanh隐藏层 -> tanh输出层。
 * 权重以扁平数组存储：weights[l] 为从层 l 到 l+1 的矩阵 (rows = sizes[l], cols = sizes[l+1])。
 */
export class SimpleNN {
  sizes: number[];
  private weights: number[][];
  private biases: number[][];

  constructor(sizes: number[], randomize = true) {
    this.sizes = sizes;
    this.weights = [];
    this.biases = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const rows = sizes[l];
      const cols = sizes[l + 1];
      const w: number[] = new Array(rows * cols);
      const b: number[] = new Array(cols);
      for (let i = 0; i < w.length; i++) w[i] = randomize ? (Math.random() * 2 - 1) * 0.3 : 0;
      for (let j = 0; j < cols; j++) b[j] = randomize ? (Math.random() * 2 - 1) * 0.2 : 0;
      this.weights.push(w);
      this.biases.push(b);
    }
  }

  /** 前向传播 */
  forward(input: number[]): number[] {
    let cur = input;
    for (let l = 0; l < this.sizes.length - 1; l++) {
      const rows = this.sizes[l];
      const cols = this.sizes[l + 1];
      const w = this.weights[l];
      const b = this.biases[l];
      const next = new Array<number>(cols);
      for (let j = 0; j < cols; j++) {
        let sum = b[j];
        for (let i = 0; i < rows; i++) sum += w[i * cols + j] * cur[i];
        next[j] = Math.tanh(sum);
      }
      cur = next;
    }
    return cur;
  }

  getWeights(): number[] {
    return this.weights.flat();
  }

  getBiases(): number[] {
    return this.biases.flat();
  }

  setFromFlat(weights: number[], biases: number[]): void {
    let wi = 0;
    let bi = 0;
    for (let l = 0; l < this.sizes.length - 1; l++) {
      const n = this.sizes[l] * this.sizes[l + 1];
      this.weights[l] = weights.slice(wi, wi + n);
      wi += n;
      this.biases[l] = biases.slice(bi, bi + this.sizes[l + 1]);
      bi += this.sizes[l + 1];
    }
  }

  /** 权重视突变 */
  mutate(rate: number, strength: number): void {
    for (let l = 0; l < this.weights.length; l++) {
      const w = this.weights[l];
      for (let i = 0; i < w.length; i++) {
        if (Math.random() < rate) w[i] += gaussianRandom(0, strength);
      }
      const b = this.biases[l];
      for (let i = 0; i < b.length; i++) {
        if (Math.random() < rate) b[i] += gaussianRandom(0, strength);
      }
    }
  }

  clone(): SimpleNN {
    const nn = new SimpleNN(this.sizes, false);
    nn.setFromFlat(this.getWeights(), this.getBiases());
    return nn;
  }

  /**
   * 剑心开悟：隐藏层扩容 (v1.12.0)。
   * 新权重/偏置全部置 0——升级瞬间决策行为不变，靠后续突变逐代调优。
   */
  expandHidden(newHidden: number): void {
    if (newHidden <= this.sizes[1]) return;
    const [input, , output] = this.sizes;
    const oldHidden = this.sizes[1];
    // 层 0 (input→hidden)：旧列保留，新增列置 0
    const w0 = this.weights[0];
    const nw0 = new Array<number>(input * newHidden).fill(0);
    for (let i = 0; i < input; i++) {
      for (let j = 0; j < oldHidden; j++) nw0[i * newHidden + j] = w0[i * oldHidden + j];
    }
    // 层 1 (hidden→output)：旧行保留，新行置 0
    const w1 = this.weights[1];
    const nw1 = new Array<number>(newHidden * output).fill(0);
    for (let j = 0; j < oldHidden; j++) {
      for (let k = 0; k < output; k++) nw1[j * output + k] = w1[j * output + k];
    }
    // 隐藏层 bias：旧保留，新增置 0
    const b0 = this.biases[0];
    const nb0 = new Array<number>(newHidden).fill(0);
    for (let j = 0; j < oldHidden; j++) nb0[j] = b0[j];
    this.sizes[1] = newHidden;
    this.weights = [nw0, nw1];
    this.biases = [nb0, this.biases[1]];
  }
}
