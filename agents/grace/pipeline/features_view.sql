-- Model-Ready Feature View for NFP Nowcasting
-- Run this after schema.sql and data ingestion to create a unified feature table

CREATE VIEW IF NOT EXISTS v_nfp_features AS
WITH nfp_months AS (
    SELECT
        release_date,
        actual_value,
        consensus_forecast,
        kalshi_implied_mean,
        kalshi_implied_mode,
        our_model_prediction
    FROM nfp_release
),
claims_agg AS (
    SELECT
        strftime('%Y-%m', week_ending_date) || '-01' AS month_date,
        AVG(value) AS avg_initial_claims,
        AVG(four_week_ma) AS avg_claims_4wk_ma,
        MAX(value) AS max_initial_claims,
        MIN(value) AS min_initial_claims
    FROM initial_claims
    GROUP BY strftime('%Y-%m', week_ending_date)
),
ism_agg AS (
    SELECT
        release_date,
        manufacturing_employment AS ism_manufacturing,
        services_employment AS ism_services
    FROM ism_employment
),
adp_agg AS (
    SELECT
        release_date,
        value AS adp_value,
        change AS adp_change
    FROM adp_employment
),
jobs_agg AS (
    SELECT
        strftime('%Y-%m', date) || '-01' AS month_date,
        AVG(count) AS avg_job_postings,
        AVG(change_mom) AS avg_job_postings_mom
    FROM job_postings
    GROUP BY strftime('%Y-%m', date)
),
cc_agg AS (
    SELECT
        strftime('%Y-%m', date) || '-01' AS month_date,
        AVG(value) AS avg_cc_spending,
        AVG(change_yoy) AS avg_cc_spending_yoy
    FROM credit_card_spending
    GROUP BY strftime('%Y-%m', date)
)
SELECT
    n.release_date,
    n.actual_value,
    n.consensus_forecast,
    n.kalshi_implied_mean,
    n.kalshi_implied_mode,
    n.our_model_prediction,
    c.avg_initial_claims,
    c.avg_claims_4wk_ma,
    c.max_initial_claims,
    c.min_initial_claims,
    i.ism_manufacturing,
    i.ism_services,
    a.adp_value,
    a.adp_change,
    j.avg_job_postings,
    j.avg_job_postings_mom,
    cc.avg_cc_spending,
    cc.avg_cc_spending_yoy
FROM nfp_months n
LEFT JOIN claims_agg c ON n.release_date = c.month_date
LEFT JOIN ism_agg i ON n.release_date = i.release_date
LEFT JOIN adp_agg a ON n.release_date = a.release_date
LEFT JOIN jobs_agg j ON n.release_date = j.month_date
LEFT JOIN cc_agg cc ON n.release_date = cc.month_date
ORDER BY n.release_date DESC;
