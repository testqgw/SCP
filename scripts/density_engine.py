import numpy as np
import scipy.stats as stats

class ContinuousDensityEngine:
    """
    Sports betting pricing engine using continuous and discrete probability distributions.
    Computes precise survival probabilities P(X > line) using Poisson and Skew-Normal models.
    """
    @staticmethod
    def poisson_survival(projection: float, line: float) -> float:
        """
        Calculates the survival probability for discrete count props (AST, REB, THREES)
        using a Poisson distribution.
        
        P(X > line) = 1 - CDF(floor(line))
        """
        if projection <= 0:
            return 0.0
        
        # Discrete props: line is typically fractional (e.g. 7.5) or integer (7)
        # Standard grading: Over wins if actual > line
        k = int(np.floor(line))
        
        # scipy.stats.poisson.cdf(k, mu) calculates P(X <= k)
        cdf_value = stats.poisson.cdf(k, mu=projection)
        
        return 1.0 - cdf_value

    @staticmethod
    def skewnorm_survival(projection: float, line: float, std_dev: float, skewness: float = 0.0) -> float:
        """
        Calculates the survival probability for continuous stats (PTS) 
        using a Skew-Normal distribution to handle tail skewness.
        
        P(X > line) = 1 - CDF(line)
        """
        if std_dev <= 0:
            return 1.0 if projection > line else 0.0
            
        # Standard Normal / Skew-Normal survival function
        # loc = projection (mean), scale = std_dev, a = skewness
        # Note: skewnorm mean is not exactly 'loc' when a != 0, but for standard 
        # modeling we can adjust the location or treat it as the mode/median.
        # Let's calibrate loc to match the expectation 'projection':
        # E(X) = loc + scale * delta * sqrt(2/pi)
        # where delta = a / sqrt(1 + a^2)
        delta = skewness / np.sqrt(1 + skewness**2)
        loc = projection - std_dev * delta * np.sqrt(2 / np.pi)
        
        return stats.skewnorm.sf(line, a=skewness, loc=loc, scale=std_dev)

if __name__ == "__main__":
    # Self-test demonstration with realistic player props
    print("=== NBA Sports Betting Density Engine Self-Test ===")
    
    # Rebounds/Assists (Discrete)
    jokic_ast_proj = 8.7
    jokic_ast_line = 8.5
    prob_over_ast = ContinuousDensityEngine.poisson_survival(jokic_ast_proj, jokic_ast_line)
    print(f"Jokic Assists: Proj={jokic_ast_proj}, Line={jokic_ast_line}")
    print(f"  P(X > 8.5) = {prob_over_ast:.4f} ({prob_over_ast * 100:.2f}% probability of OVER)")
    
    # Points (Continuous/Skew-Normal)
    giannis_pts_proj = 31.4
    giannis_pts_line = 30.5
    giannis_pts_std = 6.2
    giannis_pts_skew = 0.45  # Right-skewed point distribution
    
    prob_over_pts_skew = ContinuousDensityEngine.skewnorm_survival(
        giannis_pts_proj, giannis_pts_line, giannis_pts_std, giannis_pts_skew
    )
    prob_over_pts_normal = ContinuousDensityEngine.skewnorm_survival(
        giannis_pts_proj, giannis_pts_line, giannis_pts_std, skewness=0.0
    )
    
    print(f"Giannis Points: Proj={giannis_pts_proj}, Line={giannis_pts_line}, SD={giannis_pts_std}")
    print(f"  P(X > 30.5) [Skew-Normal, a={giannis_pts_skew}] = {prob_over_pts_skew:.4f} ({prob_over_pts_skew * 100:.2f}% probability of OVER)")
    print(f"  P(X > 30.5) [Gaussian Normal]            = {prob_over_pts_normal:.4f} ({prob_over_pts_normal * 100:.2f}% probability of OVER)")
    print(f"  Tail Edge Premium from Skewness: {(prob_over_pts_skew - prob_over_pts_normal)*100:+.2f}%")
