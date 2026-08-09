import { gaussianRandom } from '../utils/mathUtils';

/**
 * 剑心 —— 极简前馈神经网络 (纯函数，无外部依赖，便于突变与序列化)。
 * 结构：输入层 -> tanh隐藏层 -> tanh输出层。
 * 权重以扁平数组存储：weights[l] 为从层 l 到 l+1 的矩阵 (rows = sizes[l], cols = sizes[l+1])。
 */
export class SimpleNN {
  readonly sizes: number[];
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
}
