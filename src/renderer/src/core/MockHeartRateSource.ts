export class MockHeartRateSource {
  private bpm = 78

  next(): number {
    const movement = Math.round((Math.random() - 0.45) * 8)
    this.bpm = this.bpm + movement

    if (Math.random() > 0.92) {
      this.bpm += Math.round(Math.random() * 18)
    }

    this.bpm = Math.max(55, Math.min(165, this.bpm))
    return this.bpm
  }
}
